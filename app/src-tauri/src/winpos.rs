//! 창 위치·크기 저장/복원 — **논리 좌표**(macOS 포인트)로 설정 폴더의 `window-pos.json`에 둔다.
//!
//! tauri-plugin-window-state(2.5.0)는 물리 픽셀로 저장하고, 복원은 창을 만든 직후(아직 숨김)에
//! `set_size(Physical)`/`set_position(Physical)`로 한다. 이때 숨긴 새 창의 `backingScaleFactor`가 1이라
//! 물리값이 그대로 논리값이 되어 Retina(배율 2)에서는 저장·복원마다 크기·위치가 2배가 됐다.
//! 또 macOS의 모니터 "물리 좌표"는 모니터마다 자기 배율을 곱한 값이라 배율이 다른 모니터를 섞으면 좌표계가 어긋난다.
//! 그래서 여기서는 저장도 복원도 논리 좌표만 쓴다(창 배율로 나눈 값 = NSWindow frame 그대로).
//!
//! - main: 위치 + 크기(안쪽 크기)
//! - widget: 위치만 (크기는 내용에 맞춰 `resize_widget`이 정한다)
//! - 저장값이 엉망이거나 지금 연결된 어느 모니터에도 충분히 걸치지 않으면 기본 모니터 안으로(main 가운데, widget 오른쪽 아래)

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, Monitor, WebviewWindow};

pub const FILE: &str = "window-pos.json";

/// 논리 좌표 사각형 (왼쪽 위 원점)
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Kind {
    /// 큰 창: 위치·크기 복원, 기본 자리는 가운데
    Main,
    /// 위젯: 위치만 복원, 기본 자리는 오른쪽 아래
    Widget,
}

impl Kind {
    pub fn of(label: &str) -> Option<Self> {
        match label {
            "main" => Some(Kind::Main),
            "widget" => Some(Kind::Widget),
            _ => None,
        }
    }
}

/// 모니터 (논리 좌표): 전체 영역, 작업 영역(메뉴 막대·Dock 제외)
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mon {
    pub full: Rect,
    pub work: Rect,
}

/// 앱 상태로 관리: 저장 파일 경로 + 메모리 사본
pub struct WinPos {
    path: PathBuf,
    saved: Mutex<HashMap<String, Rect>>,
    /// 마지막 변경 번호 — 이동·크기 조절 중엔 이벤트가 쏟아지므로 멈춘 뒤 한 번만 쓴다
    gen: Arc<AtomicU64>,
}

/// 이동이 멈춘 뒤 파일에 쓰기까지 기다리는 시간
const SAVE_DELAY: Duration = Duration::from_millis(400);

impl WinPos {
    pub fn load(config_dir: PathBuf) -> Self {
        // 예전 플러그인 파일(물리 픽셀, 2배로 불어난 값)은 더 이상 쓰지 않는다
        std::fs::remove_file(config_dir.join(".window-state.json")).ok();
        let path = config_dir.join(FILE);
        let saved = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<HashMap<String, Rect>>(&b).ok())
            .unwrap_or_default();
        Self {
            path,
            saved: Mutex::new(saved),
            gen: Arc::new(AtomicU64::new(0)),
        }
    }

    fn get(&self, label: &str) -> Option<Rect> {
        self.saved.lock().ok()?.get(label).copied()
    }

    fn put(&self, label: &str, r: Rect) {
        let Ok(mut m) = self.saved.lock() else { return };
        if m.get(label) == Some(&r) {
            return;
        }
        m.insert(label.to_string(), r);
        let Ok(b) = serde_json::to_vec_pretty(&*m) else { return };
        drop(m);
        // 이벤트 루프에서 바로 쓰지 않고, 마지막 변경 뒤 SAVE_DELAY 동안 조용하면 백그라운드에서 한 번 쓴다
        let my = self.gen.fetch_add(1, Ordering::SeqCst) + 1;
        let (gen, path) = (self.gen.clone(), self.path.clone());
        std::thread::spawn(move || {
            std::thread::sleep(SAVE_DELAY);
            if gen.load(Ordering::SeqCst) == my {
                write_atomic(&path, &b);
            }
        });
    }

    /// 종료 직전: 기다리는 쓰기가 있으면 바로 쓴다
    pub fn flush(&self) {
        let Ok(m) = self.saved.lock() else { return };
        if let Ok(b) = serde_json::to_vec_pretty(&*m) {
            self.gen.fetch_add(1, Ordering::SeqCst);
            write_atomic(&self.path, &b);
        }
    }
}

/// 임시 파일에 쓰고 rename (쓰다 끊겨도 깨진 파일이 남지 않게)
fn write_atomic(path: &std::path::Path, b: &[u8]) {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).ok();
    }
    let tmp = path.with_extension(format!("json.{}.tmp", std::process::id()));
    if std::fs::write(&tmp, b).is_ok() && std::fs::rename(&tmp, path).is_err() {
        std::fs::remove_file(&tmp).ok();
    }
}

/// 저장값이 쓸 만한지 (첫 실행·깨진 파일·말이 안 되는 값은 버림)
pub fn sane(r: &Rect) -> bool {
    [r.x, r.y, r.w, r.h].iter().all(|v| v.is_finite())
        && r.x.abs() < 50_000.0
        && r.y.abs() < 50_000.0
        && (40.0..=20_000.0).contains(&r.w)
        && (40.0..=20_000.0).contains(&r.h)
}

/// 두 사각형이 겹치는 가로·세로 길이
fn overlap(a: &Rect, b: &Rect) -> (f64, f64) {
    let ox = (a.x + a.w).min(b.x + b.w) - a.x.max(b.x);
    let oy = (a.y + a.h).min(b.y + b.h) - a.y.max(b.y);
    (ox.max(0.0), oy.max(0.0))
}

/// 창이 어느 모니터와 최소 40×40(논리) 이상 겹치면 그 모니터 (가장 많이 겹치는 것)
pub fn host<'a>(r: &Rect, mons: &'a [Mon]) -> Option<&'a Mon> {
    mons.iter()
        .map(|m| (m, overlap(r, &m.full)))
        .filter(|(_, (ox, oy))| *ox >= 40.0 && *oy >= 40.0)
        .max_by(|a, b| (a.1 .0 * a.1 .1).total_cmp(&(b.1 .0 * b.1 .1)))
        .map(|(m, _)| m)
}

/// 복원할 자리를 정한다 (순수 함수).
/// `saved`: 저장값, `cur`: 지금 창 크기(빌더 기본값 또는 내용 크기), `primary`: 기본 모니터
pub fn place(kind: Kind, saved: Option<Rect>, cur: (f64, f64), mons: &[Mon], primary: &Mon) -> Rect {
    let saved = saved.filter(sane);
    let size = match (kind, saved) {
        (Kind::Main, Some(s)) => (s.w, s.h),
        _ => cur,
    };
    if let Some(s) = saved {
        let r = Rect {
            x: s.x,
            y: s.y,
            w: size.0,
            h: size.1,
        };
        if let Some(m) = host(&r, mons) {
            // 그 모니터 작업 영역보다 크면 줄여서 작업 영역 안에 넣고, 제목 막대가 메뉴 막대 위로 숨지 않게
            let w = r.w.min(m.work.w);
            let h = r.h.min(m.work.h);
            let mut x = r.x;
            // 제목 막대(위쪽 28pt)가 어느 모니터의 작업 영역에도 제대로 걸치지 않으면(위쪽 모니터를 뺐거나 메뉴 막대 밑) 이 모니터 작업 영역 위로 끌어내린다
            let bar = Rect {
                x: r.x,
                y: r.y,
                w: r.w,
                h: 28.0,
            };
            let bar_ok = mons.iter().any(|mm| {
                let (ox, oy) = overlap(&bar, &mm.work);
                ox >= 80.0_f64.min(r.w) && oy >= 20.0
            });
            let mut y = if !bar_ok && r.y < m.work.y { m.work.y } else { r.y };
            if w < r.w {
                x = x.clamp(m.work.x, m.work.x + m.work.w - w);
            }
            if h < r.h {
                y = y.clamp(m.work.y, m.work.y + m.work.h - h);
            }
            return Rect { x, y, w, h };
        }
    }
    // 기본 모니터 안으로. 위젯은 지난번 내용 크기(저장값)가 더 크면 그 크기로 자리를 잡는다 → 내용 크기로 바뀌어도 화면 안
    let size = match (kind, saved) {
        (Kind::Widget, Some(s)) => (s.w.max(cur.0), s.h.max(cur.1)),
        _ => size,
    };
    let a = primary.work;
    let w = size.0.min(a.w);
    let h = size.1.min(a.h);
    match kind {
        Kind::Main => Rect {
            x: a.x + (a.w - w) / 2.0,
            y: a.y + (a.h - h) / 2.0,
            w,
            h,
        },
        Kind::Widget => {
            let margin = 24.0;
            Rect {
                x: (a.x + a.w - w - margin).max(a.x),
                y: (a.y + a.h - h - margin).max(a.y),
                w,
                h,
            }
        }
    }
}

fn mon(m: &Monitor) -> Mon {
    let s = m.scale_factor();
    let (p, z) = (m.position(), m.size());
    let wa = m.work_area();
    Mon {
        full: Rect {
            x: p.x as f64 / s,
            y: p.y as f64 / s,
            w: z.width as f64 / s,
            h: z.height as f64 / s,
        },
        work: Rect {
            x: wa.position.x as f64 / s,
            y: wa.position.y as f64 / s,
            w: wa.size.width as f64 / s,
            h: wa.size.height as f64 / s,
        },
    }
}

/// 창의 지금 자리 (논리). 위치는 바깥 프레임 왼쪽 위, 크기는 안쪽(= set_size가 받는 크기)
fn current(w: &WebviewWindow) -> Option<Rect> {
    let s = w.scale_factor().ok()?;
    let p = w.outer_position().ok()?;
    let z = w.inner_size().ok()?;
    Some(Rect {
        x: p.x as f64 / s,
        y: p.y as f64 / s,
        w: z.width as f64 / s,
        h: z.height as f64 / s,
    })
}

/// 창을 만든 직후(보이기 전) 호출: 저장된 자리로 옮기고, 이후 이동·크기 변경을 저장한다
pub fn attach(app: &AppHandle, w: &WebviewWindow) {
    if Kind::of(w.label()).is_none() {
        return;
    }
    reposition(app, w);
    let a = app.clone();
    let w2 = w.clone();
    w.on_window_event(move |e| {
        if matches!(
            e,
            tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_) | tauri::WindowEvent::ScaleFactorChanged { .. }
        ) {
            remember(&a, &w2);
        }
    });
}

/// 저장된 자리(없으면 기본 자리)를 지금 모니터 구성으로 다시 계산해 옮긴다(`place`). 만들 때와,
/// 숨겨 둔 위젯을 다시 보일 때(그 사이 모니터를 뺐으면 화면 밖에 뜨지 않게) 부른다
pub fn reposition(app: &AppHandle, w: &WebviewWindow) {
    let Some(kind) = Kind::of(w.label()) else { return };
    let Some(st) = app.try_state::<WinPos>() else { return };
    let mons: Vec<Mon> = app.available_monitors().unwrap_or_default().iter().map(mon).collect();
    let primary = app
        .primary_monitor()
        .ok()
        .flatten()
        .map(|m| mon(&m))
        .or_else(|| mons.first().copied());
    let cur = current(w);
    if let (Some(primary), Some(cur)) = (primary, cur) {
        let saved = st.get(w.label());
        let r = place(kind, saved, (cur.w, cur.h), &mons, &primary);
        wlog!(
            "winpos",
            "창 복원({}): 창 배율 {:?}, 저장 {saved:?} → {r:?}",
            w.label(),
            w.scale_factor().ok()
        );
        if kind == Kind::Main {
            w.set_size(LogicalSize::new(r.w, r.h)).ok();
        }
        w.set_position(LogicalPosition::new(r.x, r.y)).ok();
    }
}

/// 지금 자리를 저장 (최소화·전체 화면·숨김 상태는 건너뜀)
pub fn remember(app: &AppHandle, w: &WebviewWindow) {
    if w.is_minimized().unwrap_or(true) || w.is_fullscreen().unwrap_or(true) || !w.is_visible().unwrap_or(false) {
        return;
    }
    let (Some(st), Some(r)) = (app.try_state::<WinPos>(), current(w)) else {
        return;
    };
    if sane(&r) {
        st.put(w.label(), r);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(x: f64, y: f64, w: f64, h: f64) -> Rect {
        Rect { x, y, w, h }
    }

    /// 실제 사용자 배치 (논리): 내장 1728×1117(기본, 메뉴 막대 33) / 위쪽 5K 2560×1440 / 위쪽 오른편 세로 1080×1920
    fn desk() -> Vec<Mon> {
        vec![
            Mon {
                full: rect(0.0, 0.0, 1728.0, 1117.0),
                work: rect(0.0, 33.0, 1728.0, 1084.0),
            },
            Mon {
                full: rect(-832.0, -1440.0, 2560.0, 1440.0),
                work: rect(-832.0, -1415.0, 2560.0, 1415.0),
            },
            Mon {
                full: rect(1728.0, -1440.0, 1080.0, 1920.0),
                work: rect(1728.0, -1415.0, 1080.0, 1895.0),
            },
        ]
    }

    #[test]
    fn title_bar_pulled_down_when_upper_monitor_gone() {
        let d = desk();
        // 5K(위)와 내장에 걸쳐 있던 큰 창 — 5K를 빼면 내장만 남아 제목 막대가 화면 밖 → 메뉴 막대 아래로
        let s = rect(100.0, -300.0, 800.0, 700.0);
        assert_eq!(place(Kind::Main, Some(s), (1100.0, 760.0), &d[..1], &d[0]).y, 33.0);
        // 5K가 연결돼 있으면 제목 막대가 5K 작업 영역에 있으니 그대로
        assert_eq!(place(Kind::Main, Some(s), (1100.0, 760.0), &d, &d[0]).y, -300.0);
    }

    #[test]
    fn hidden_widget_back_on_screen_after_monitor_removed() {
        // 오른쪽 위 세로 모니터에 두고 숨긴 위젯 — 그 모니터를 뺀 뒤 다시 보이면(reposition) 남은 화면 안으로
        let d = desk();
        let saved = rect(1900.0, -1000.0, 300.0, 132.0);
        let r = place(Kind::Widget, Some(saved), (300.0, 132.0), &d[..1], &d[0]);
        assert!(r.x >= 0.0 && r.x + 300.0 <= 1728.0 && r.y >= 33.0 && r.y + 132.0 <= 1117.0, "{r:?}");
        // 모니터가 그대로면 제자리
        assert_eq!(place(Kind::Widget, Some(saved), (300.0, 132.0), &d, &d[0]).x, 1900.0);
    }

    #[test]
    fn flush_writes_atomically() {
        let dir = std::env::temp_dir().join(format!("wr-winpos-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        let wp = WinPos::load(dir.clone());
        wp.put("main", rect(10.0, 40.0, 800.0, 600.0));
        wp.flush();
        let again = WinPos::load(dir.clone());
        assert_eq!(again.get("main"), Some(rect(10.0, 40.0, 800.0, 600.0)));
        let leftovers = std::fs::read_dir(&dir)
            .unwrap()
            .filter(|e| e.as_ref().unwrap().path().to_string_lossy().ends_with(".tmp"))
            .count();
        assert_eq!(leftovers, 0, "임시 파일이 남지 않음");
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn restores_same_place_on_any_monitor() {
        let d = desk();
        // 큰 창: 내장 화면 그대로
        let s = rect(648.0, 171.0, 1080.0, 946.0);
        assert_eq!(place(Kind::Main, Some(s), (1100.0, 760.0), &d, &d[0]), s);
        // 위젯: 세로 모니터·5K 위에 둔 자리 그대로 (크기는 지금 크기)
        let s = rect(2200.0, -300.0, 999.0, 999.0);
        assert_eq!(
            place(Kind::Widget, Some(s), (300.0, 132.0), &d, &d[0]),
            rect(2200.0, -300.0, 300.0, 132.0)
        );
        let s = rect(-500.0, -1000.0, 300.0, 132.0);
        assert_eq!(place(Kind::Widget, Some(s), (300.0, 132.0), &d, &d[0]), s);
        // 두 모니터 경계에 걸친 위젯도 그대로
        let s = rect(1650.0, -60.0, 300.0, 132.0);
        assert_eq!(place(Kind::Widget, Some(s), (300.0, 132.0), &d, &d[0]), s);
    }

    #[test]
    fn accident_values_go_back_on_screen() {
        let d = desk();
        // 실제 사고 (플러그인이 2배로 불린 값): 위젯 (0,1952), 큰 창 2160×1892 @ (1296,342)
        let r = place(Kind::Widget, Some(rect(0.0, 1952.0, 564.0, 324.0)), (300.0, 132.0), &d, &d[0]);
        assert_eq!(
            r,
            rect(1728.0 - 564.0 - 24.0, 1117.0 - 324.0 - 24.0, 564.0, 324.0),
            "기본 모니터 오른쪽 아래"
        );
        let r = place(Kind::Widget, Some(rect(4.0, 3816.0, 1128.0, 648.0)), (300.0, 132.0), &d, &d[0]);
        assert!(host(&r, &d[..1]).is_some());
        // 큰 창이 화면보다 크면 작업 영역에 맞춰 줄임
        let r = place(Kind::Main, Some(rect(1296.0, 342.0, 2160.0, 1892.0)), (1100.0, 760.0), &d, &d[0]);
        assert_eq!(r, rect(0.0, 33.0, 1728.0, 1084.0));
        // 모니터를 뺀 경우: 세로 모니터 자리에 있던 큰 창 → 기본 모니터 가운데
        let only = &d[..1];
        let r = place(Kind::Main, Some(rect(1800.0, -1000.0, 1000.0, 800.0)), (1100.0, 760.0), only, &d[0]);
        assert_eq!(r, rect(364.0, 175.0, 1000.0, 800.0));
        // 모서리만 살짝 겹침 → 기본 자리
        let r = place(Kind::Widget, Some(rect(1700.0, 1100.0, 300.0, 132.0)), (300.0, 132.0), &d, &d[0]);
        assert_eq!(r.x, 1728.0 - 324.0);
    }

    #[test]
    fn bad_or_missing_saved_value_is_ignored() {
        let d = desk();
        let first = place(Kind::Main, None, (1100.0, 760.0), &d, &d[0]);
        assert_eq!(first, rect(314.0, 195.0, 1100.0, 760.0), "첫 실행: 가운데");
        for bad in [
            rect(f64::NAN, 0.0, 800.0, 600.0),
            rect(0.0, 0.0, 0.0, 600.0),
            rect(0.0, 0.0, 800.0, 1e9),
            rect(1e12, 0.0, 800.0, 600.0),
        ] {
            assert_eq!(place(Kind::Main, Some(bad), (1100.0, 760.0), &d, &d[0]), first, "{bad:?}");
        }
        // 제목 막대가 메뉴 막대 밑으로 들어간 값 → 작업 영역 위로 맞춤
        let r = place(Kind::Main, Some(rect(100.0, 10.0, 800.0, 600.0)), (1100.0, 760.0), &d, &d[0]);
        assert_eq!(r.y, 33.0);
    }

    #[test]
    fn file_roundtrip_and_garbage() {
        let dir = std::env::temp_dir().join(format!("waitscape-winpos-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join(FILE), b"{not json").unwrap();
        assert!(WinPos::load(dir.clone()).get("main").is_none());
        let st = WinPos::load(dir.clone());
        st.put("widget", rect(2200.0, -300.0, 300.0, 132.0));
        // put은 이동이 멈춘 뒤(SAVE_DELAY) 백그라운드에서 쓴다 → 기다리거나 flush
        std::thread::sleep(SAVE_DELAY * 2);
        assert_eq!(WinPos::load(dir.clone()).get("widget"), Some(rect(2200.0, -300.0, 300.0, 132.0)));
        std::fs::remove_dir_all(&dir).ok();
    }
}
