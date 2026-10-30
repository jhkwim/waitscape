//! 외부 모드 설치·삭제 (ARCHITECTURE §4.6). 폴더·zip·드래그 앤 드롭 모두 `prepare()` → (사용자 확인) → `commit()`.
//!
//! - `prepare`: 원본(폴더 또는 zip)을 **임시 스테이징 폴더로 복사·압축 해제**하면서 검사한다. 이후 원본이 바뀌어도 확인받은 내용만 설치된다.
//!   경로 탈출(`..`·절대 경로·드라이브)·심볼릭 링크 거부, 확장자 화이트리스트, 최대 20MB·500개 파일·깊이 6.
//!   `mode.json`: id 형식, 내장 id와 겹침 금지, semver, needs는 알려진 권한만.
//! - `commit`: `<사용자 모드 폴더>/<id>/`로 옮기고 파일 SHA-256 목록을 `.install.json`에 남긴다. 설치 직후에는 꺼진 상태(켜기는 프론트에서 동의 후).
//!   업데이트는 새 판을 같은 폴더의 `.<id>.new-*`로 먼저 옮기고, 기존 판을 `.<id>.old-*`로 비켜 둔 뒤 바꿔 끼운다.
//!   바꿔 끼우기가 실패하면 기존 판을 되돌린다. 도중에 앱이 꺼져 남은 `.new-`·`.old-`는 `recover`가 정리한다.
//! - `remove`: 사용자 모드 폴더 안의 `<id>` 폴더만(링크 아님) 지운다.

use serde_json::{json, Value};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

pub const MAX_BYTES: u64 = 20 * 1024 * 1024;
pub const MAX_FILES: usize = 500;
const MAX_DEPTH: usize = 6;
pub const PERMS: [&str; 4] = ["trace", "memo", "notify", "clipboard"];
const EXTS: [&str; 15] = [
    "js", "css", "json", "svg", "png", "jpg", "webp", "gif", "woff2", "ttf", "mp3", "ogg", "wav", "md", "txt",
];

fn id_ok(id: &str) -> bool {
    wr_core::modes::rules().mode_id.is_match(id)
}

fn ext_ok(name: &str) -> bool {
    // LICENSE·README 같은 확장자 없는 텍스트는 허용하지 않고 건너뛰지도 않는다 → 거부 (명확하게)
    name.rsplit_once('.')
        .map(|(_, e)| EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// 패키지 안 상대 경로 검사: 정상 구성요소만, 각 이름은 [A-Za-z0-9._-], 숨김 파일 금지
fn rel_ok(rel: &Path) -> bool {
    let mut n = 0;
    for c in rel.components() {
        match c {
            Component::Normal(s) => {
                let Some(s) = s.to_str() else { return false };
                if s.is_empty() || s.starts_with('.') || !s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-')) {
                    return false;
                }
                n += 1;
            }
            _ => return false,
        }
    }
    n > 0 && n <= MAX_DEPTH
}

#[derive(Debug)]
pub struct Staged {
    pub dir: PathBuf,
    pub id: String,
    pub info: Value,
}

fn err<T>(m: impl Into<String>) -> Result<T, String> {
    Err(m.into())
}

/// 숨김 파일(.DS_Store, __MACOSX 등)과 Windows 탐색기가 만드는 desktop.ini·Thumbs.db는 조용히 건너뛴다
fn skip_name(rel: &str) -> bool {
    rel.split('/')
        .any(|p| p.starts_with('.') || p == "__MACOSX" || p.eq_ignore_ascii_case("desktop.ini") || p.eq_ignore_ascii_case("thumbs.db"))
}

struct Budget {
    files: usize,
    bytes: u64,
}

impl Budget {
    fn add(&mut self, n: u64) -> Result<(), String> {
        self.files += 1;
        if self.files > MAX_FILES {
            return err(format!("파일이 너무 많아요 (최대 {MAX_FILES}개)"));
        }
        // zip 선언 크기는 믿을 수 없다: 릴리스 빌드에서 덧셈이 넘쳐 한도를 우회하지 않게 checked_add
        match self.bytes.checked_add(n) {
            Some(b) if b <= MAX_BYTES => {
                self.bytes = b;
                Ok(())
            }
            _ => err("패키지가 너무 커요 (최대 20MB)"),
        }
    }
}

fn copy_dir(src: &Path, dst: &Path, rel: &Path, b: &mut Budget) -> Result<(), String> {
    let rd = std::fs::read_dir(src.join(rel)).map_err(|_| "폴더를 읽을 수 없어요".to_string())?;
    for e in rd.flatten() {
        let name = e.file_name().to_string_lossy().to_string();
        let r = rel.join(&name);
        if skip_name(&name) {
            continue;
        }
        let md = std::fs::symlink_metadata(e.path()).map_err(|_| "파일 정보를 읽을 수 없어요".to_string())?;
        if md.file_type().is_symlink() {
            return err(format!("심볼릭 링크는 설치할 수 없어요: {}", r.display()));
        }
        if !rel_ok(&r) {
            return err(format!("허용되지 않는 경로예요: {}", r.display()));
        }
        if md.is_dir() {
            std::fs::create_dir_all(dst.join(&r)).map_err(|e| e.to_string())?;
            copy_dir(src, dst, &r, b)?;
        } else if md.is_file() {
            if !ext_ok(&name) {
                return err(format!("허용되지 않는 파일 형식이에요: {}", r.display()));
            }
            b.add(md.len())?;
            std::fs::copy(e.path(), dst.join(&r)).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn unzip(src: &Path, dst: &Path) -> Result<(), String> {
    let f = std::fs::File::open(src).map_err(|_| "zip 파일을 열 수 없어요".to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|_| "zip 형식이 아니에요".to_string())?;
    let mut b = Budget { files: 0, bytes: 0 };
    for i in 0..z.len() {
        let mut e = z.by_index(i).map_err(|_| "zip 항목을 읽을 수 없어요".to_string())?;
        let raw = e
            .name()
            .map_err(|_| "zip 항목 이름을 읽을 수 없어요".to_string())?
            .replace('\\', "/");
        // `..`는 점으로 시작해 skip_name에 숨김 파일로 걸러지므로, 그 전에 경로 탈출로 거부한다
        if raw.starts_with('/') || raw.split('/').any(|p| p == "..") {
            return err(format!("허용되지 않는 경로예요: {raw}"));
        }
        if skip_name(&raw) {
            continue;
        }
        if e.is_symlink() {
            return err(format!("심볼릭 링크는 설치할 수 없어요: {raw}"));
        }
        // enclosed_name: 절대 경로·`..`·드라이브 접두사를 거른다. 그 위에 우리 규칙을 한 번 더
        let Some(rel) = e.enclosed_name() else {
            return err(format!("경로 탈출 시도: {raw}"));
        };
        if raw.starts_with('/') || raw.split('/').any(|p| p == "..") || !rel_ok(&rel) {
            return err(format!("허용되지 않는 경로예요: {raw}"));
        }
        if e.is_dir() {
            std::fs::create_dir_all(dst.join(&rel)).map_err(|e| e.to_string())?;
            continue;
        }
        if !ext_ok(&raw) {
            return err(format!("허용되지 않는 파일 형식이에요: {raw}"));
        }
        b.add(e.size())?;
        let out = dst.join(&rel);
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        // 선언 크기를 믿지 않고 실제로 읽은 양으로 다시 제한 (zip 폭탄)
        let mut buf = vec![];
        (&mut e)
            .take(MAX_BYTES + 1)
            .read_to_end(&mut buf)
            .map_err(|_| "zip 압축 해제 실패".to_string())?;
        if buf.len() as u64 > e.size() || buf.len() as u64 > MAX_BYTES {
            return err("압축 해제 크기가 선언과 달라요");
        }
        std::fs::write(&out, buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 스테이징 폴더 안에서 mode.json이 있는 폴더(루트 또는 유일한 하위 폴더)
fn package_root(stage: &Path) -> Option<PathBuf> {
    if stage.join("mode.json").is_file() {
        return Some(stage.to_path_buf());
    }
    let dirs: Vec<PathBuf> = std::fs::read_dir(stage)
        .ok()?
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    if dirs.len() == 1 && dirs[0].join("mode.json").is_file() {
        return Some(dirs[0].clone());
    }
    None
}

fn walk_files(root: &Path, rel: &Path, out: &mut Vec<String>) {
    for e in std::fs::read_dir(root.join(rel)).into_iter().flatten().flatten() {
        let r = rel.join(e.file_name());
        if e.path().is_dir() {
            walk_files(root, &r, out);
        } else {
            out.push(r.to_string_lossy().replace('\\', "/"));
        }
    }
}

fn pick<'a>(v: &'a Value, lang: &str) -> &'a str {
    match v {
        Value::String(s) => s,
        Value::Object(o) => o
            .get(lang)
            .or_else(|| o.get("en"))
            .or_else(|| o.values().next())
            .and_then(|x| x.as_str())
            .unwrap_or(""),
        _ => "",
    }
}

/// 원본 → 스테이징 + 검사. `builtin`: 내장 모드 id 목록, `user_modes`: 설치 위치(덮어쓰기 확인용)
pub fn prepare(src: &Path, stage_dir: &Path, builtin: &[String], user_modes: &Path, lang: &str) -> Result<Staged, String> {
    std::fs::remove_dir_all(stage_dir).ok();
    std::fs::create_dir_all(stage_dir).map_err(|e| e.to_string())?;
    let r = (|| {
        let md = std::fs::symlink_metadata(src).map_err(|_| "선택한 항목을 찾을 수 없어요".to_string())?;
        if md.file_type().is_symlink() {
            return err("심볼릭 링크는 설치할 수 없어요");
        }
        if md.is_dir() {
            copy_dir(src, stage_dir, Path::new(""), &mut Budget { files: 0, bytes: 0 })?;
        } else if src
            .extension()
            .and_then(|e| e.to_str())
            .is_some_and(|e| e.eq_ignore_ascii_case("zip"))
        {
            unzip(src, stage_dir)?;
        } else {
            return err("폴더나 .zip 파일만 설치할 수 있어요");
        }
        let root = package_root(stage_dir).ok_or("mode.json을 찾을 수 없어요 (패키지 맨 위나 하나뿐인 폴더 안에 있어야 해요)")?;
        let (m, e) = wr_core::modes::read_manifest(&root.join("mode.json"));
        let m = m.ok_or(e.unwrap_or_else(|| "mode.json을 읽을 수 없어요".into()))?;
        let id = m.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
        if !id_ok(&id) {
            return err("mode.json의 id 형식이 잘못됐어요 (^[a-z0-9][a-z0-9-]{0,31}$)");
        }
        if builtin.contains(&id) {
            return err(format!("내장 모드와 id가 겹쳐요: {id}"));
        }
        let version = m.get("version").and_then(|x| x.as_str()).unwrap_or("");
        let semver = version.split(['-', '+']).next().unwrap_or("").split('.').count() == 3
            && version
                .split(['-', '+'])
                .next()
                .unwrap_or("")
                .split('.')
                .all(|p| !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()));
        if !semver {
            return err("version은 semver(예: 1.0.0)여야 해요");
        }
        let needs: Vec<String> = match m.get("needs") {
            None | Some(Value::Null) => vec![],
            Some(Value::Array(a)) => a.iter().map(|x| x.as_str().unwrap_or("?").to_string()).collect(),
            _ => return err("needs는 배열이어야 해요"),
        };
        if let Some(bad) = needs.iter().find(|n| !PERMS.contains(&n.as_str())) {
            return err(format!("알 수 없는 권한이에요: {bad}"));
        }
        // 설치 뒤 코어(core.js SAFE_PATH)·서빙(modes::rel_ok)이 거부할 경로는 처음부터 받지 않는다
        let entry = match m.get("entry") {
            None | Some(Value::Null) => "mode.js",
            Some(Value::String(s)) => s.as_str(),
            _ => return err("entry 경로가 잘못됐어요"),
        };
        if !wr_core::modes::rel_ok(entry) || !entry.ends_with(".js") {
            return err("entry 경로가 잘못됐어요");
        }
        if !root.join(entry).is_file() {
            return err(format!("entry 파일이 없어요: {entry}"));
        }
        match m.get("styles") {
            None | Some(Value::Null) => {}
            Some(Value::Array(a)) if a.len() <= 8 => {
                for x in a {
                    match x.as_str() {
                        Some(s) if wr_core::modes::rel_ok(s) && s.ends_with(".css") => {
                            if !root.join(s).is_file() {
                                return err(format!("styles 파일이 없어요: {s}"));
                            }
                        }
                        _ => return err("styles 경로가 잘못됐어요"),
                    }
                }
            }
            _ => return err("styles 경로가 잘못됐어요"),
        }
        let mut files = vec![];
        walk_files(&root, Path::new(""), &mut files);
        files.sort();
        let bytes: u64 = files
            .iter()
            .filter_map(|f| std::fs::metadata(root.join(f)).ok())
            .map(|m| m.len())
            .sum();
        let existing = wr_core::modes::read_manifest(&user_modes.join(&id).join("mode.json")).0;
        let old_needs: Vec<String> = existing
            .as_ref()
            .and_then(|e| e.get("needs"))
            .and_then(|n| n.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        let added: Vec<&String> = needs.iter().filter(|n| !old_needs.contains(n)).collect();
        let info = json!({
            "id": id,
            "name": pick(m.get("name").unwrap_or(&Value::Null), lang),
            "version": version,
            "needs": needs,
            "author": m.get("author").map(|a| if a.is_string() { a.clone() } else { a.get("name").cloned().unwrap_or(Value::Null) }),
            "license": m.get("license"),
            "description": pick(m.get("description").unwrap_or(&Value::Null), lang),
            "files": files.len(),
            "bytes": bytes,
            "replaces": existing.as_ref().and_then(|e| e.get("version")).cloned(),
            "addedNeeds": added,
        });
        // 패키지 루트를 스테이징 맨 위로 맞춘다
        let final_dir = stage_dir.with_extension("pkg");
        std::fs::remove_dir_all(&final_dir).ok();
        std::fs::rename(&root, &final_dir).map_err(|e| e.to_string())?;
        std::fs::remove_dir_all(stage_dir).ok();
        Ok(Staged { dir: final_dir, id, info })
    })();
    if r.is_err() {
        std::fs::remove_dir_all(stage_dir).ok();
    }
    r
}

/// 스테이징 → 사용자 모드 폴더. 같은 id가 있으면 교체(업데이트)
///
/// 1. 스테이징을 `<사용자 모드 폴더>/.<id>.new-*`로 옮긴다(다른 볼륨이면 복사). 실패해도 기존 판은 그대로.
/// 2. 기존 `<id>`를 `.<id>.old-*`로 비켜 둔다(같은 폴더 안 rename). Windows에서 파일이 열려 있어 실패하면 그대로 중단.
/// 3. `.new-*` → `<id>`. 실패하면 `.old-*`를 `<id>`로 되돌린다.
/// 4. 성공하면 `.old-*`를 지운다(실패해도 다음 `recover`가 지움).
pub fn commit(st: &Staged, user_modes: &Path) -> Result<(), String> {
    let _g = install_lock();
    std::fs::create_dir_all(user_modes).map_err(|e| e.to_string())?;
    if !id_ok(&st.id) {
        return err("잘못된 모드 id");
    }
    recover_id(user_modes, &st.id);
    let dst = user_modes.join(&st.id);
    let mut files = vec![];
    walk_files(&st.dir, Path::new(""), &mut files);
    files.sort();
    let hashes: serde_json::Map<String, Value> = files
        .iter()
        .map(|f| {
            let h = std::fs::read(st.dir.join(f))
                .map(|b| crate::mcp_connect::sha(&b))
                .unwrap_or_default();
            (f.clone(), json!(h))
        })
        .collect();
    let record = json!({ "id": st.id, "version": st.info["version"], "installedAt": chrono_now(), "sha256": hashes });
    std::fs::write(st.dir.join(".install.json"), serde_json::to_vec_pretty(&record).unwrap()).map_err(|e| e.to_string())?;
    let existing = match std::fs::symlink_metadata(&dst) {
        Ok(md) if md.file_type().is_symlink() || !md.is_dir() => return err("같은 이름의 항목이 폴더가 아니라 설치하지 않았어요"),
        Ok(_) => true,
        Err(_) => false,
    };
    let nonce = nonce();
    // 1. 새 판을 사용자 모드 폴더 안으로. 스테이징은 보통 같은 볼륨(앱 데이터 폴더)이지만
    //    WAITING_ROOM_MODES로 다른 볼륨을 가리키면 rename이 안 되므로 복사로 대신한다
    let new = user_modes.join(format!(".{}.new-{nonce}", st.id));
    if step("stage", || std::fs::rename(&st.dir, &new)).is_err() {
        std::fs::remove_dir_all(&new).ok();
        if let Err(e) = copy_tree(&st.dir, &new) {
            std::fs::remove_dir_all(&new).ok();
            return err(format!("설치 파일을 옮기지 못했어요: {e}"));
        }
    }
    // 2. 기존 판을 비켜 둔다
    let old = user_modes.join(format!(".{}.old-{nonce}", st.id));
    if existing {
        if let Err(e) = step("backup", || rename_retry(&dst, &old)) {
            std::fs::remove_dir_all(&new).ok();
            return err(format!(
                "기존 모드를 옮기지 못해 업데이트하지 않았어요 (사용 중인 파일이 있으면 닫고 다시 시도해 주세요): {e}"
            ));
        }
    }
    // 3. 바꿔 끼우기. 실패하면 기존 판을 되돌린다
    if let Err(e) = step("swap", || rename_retry(&new, &dst)) {
        std::fs::remove_dir_all(&new).ok();
        if existing {
            if let Err(e2) = rename_retry(&old, &dst) {
                // 되돌리기마저 실패: 기존 판은 .old-* 이름으로 남아 있고 다음 실행 때 recover가 되돌린다
                return err(format!(
                    "업데이트에 실패했어요: {e} (기존 모드 복구도 실패: {e2}. 앱을 다시 켜면 복구를 다시 시도해요)"
                ));
            }
            return err(format!("업데이트에 실패해 기존 모드를 그대로 두었어요: {e}"));
        }
        return err(format!("설치에 실패했어요: {e}"));
    }
    // 4. 비켜 둔 기존 판 정리 (실패해도 설치는 성공. 다음 recover가 지운다)
    if existing {
        std::fs::remove_dir_all(&old).ok();
    }
    Ok(())
}

// 테스트에서 특정 단계를 일부러 실패시킨다 (rename 실패 흉내)
#[cfg(test)]
thread_local! {
    static FAIL_STEP: std::cell::RefCell<Vec<&'static str>> = const { std::cell::RefCell::new(vec![]) };
}

/// 설치·업데이트·삭제·정리를 한 번에 하나만 한다. 같은 id를 동시에 커밋할 때
/// 한쪽의 `recover_id`가 다른 쪽이 만들고 있는 `.new-*`·`.old-*`를 지우거나 되돌리지 않게 한다
static INSTALL: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn install_lock() -> std::sync::MutexGuard<'static, ()> {
    // 앞선 작업이 패닉했어도 보호하는 데이터가 없으므로 그대로 이어서 쓴다
    INSTALL.lock().unwrap_or_else(|e| e.into_inner())
}

/// 같은 폴더 안 rename. Windows에서는 바이러스 검사기·검색 색인이 막 만든 파일을 잠깐 잡고 있어
/// 실패할 수 있으므로 150ms 간격으로 두 번 더 시도한다(테스트 훅 `step`은 이 함수를 부르기 전에 실패시킨다)
fn rename_retry(from: &Path, to: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    for _ in 0..2 {
        if std::fs::rename(from, to).is_ok() {
            return Ok(());
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    std::fs::rename(from, to)
}

/// 파일 시스템 한 단계. 테스트에서는 이름으로 골라 실제로 실행하지 않고 실패시킬 수 있다
#[cfg_attr(not(test), allow(unused_variables))]
fn step(name: &'static str, f: impl FnOnce() -> std::io::Result<()>) -> std::io::Result<()> {
    #[cfg(test)]
    if FAIL_STEP.with(|s| s.borrow().contains(&name)) {
        return Err(std::io::Error::other(format!("test: {name} 실패")));
    }
    f()
}

fn nonce() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(0);
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{t:x}{:x}{:x}", std::process::id(), N.fetch_add(1, Ordering::Relaxed))
}

/// 다른 볼륨으로 옮길 때 쓰는 복사. 스테이징은 이미 검사를 통과했으므로 일반 파일·폴더만 따라간다(링크는 건너뜀)
fn copy_tree(src: &Path, dst: &Path) -> std::io::Result<()> {
    std::fs::create_dir(dst)?;
    for e in std::fs::read_dir(src)? {
        let e = e?;
        let md = std::fs::symlink_metadata(e.path())?;
        let to = dst.join(e.file_name());
        if md.is_dir() {
            copy_tree(&e.path(), &to)?;
        } else if md.is_file() {
            std::fs::copy(e.path(), &to)?;
        }
    }
    Ok(())
}

/// `.<id>.new-<nonce>` / `.<id>.old-<nonce>` 이름을 해석한다. 이 형식이 아니면 None (사용자 파일은 건드리지 않는다)
fn leftover(name: &str) -> Option<(&str, bool)> {
    let (id, rest) = name.strip_prefix('.')?.split_once('.')?;
    let (is_old, n) = if let Some(n) = rest.strip_prefix("old-") {
        (true, n)
    } else {
        (false, rest.strip_prefix("new-")?)
    };
    (id_ok(id) && !n.is_empty() && n.bytes().all(|b| b.is_ascii_hexdigit())).then_some((id, is_old))
}

/// 도중에 앱이 꺼져 남은 설치 흔적을 정리한다 (앱 시작 때 전체, 설치 직전에 그 id만).
/// - `.new-*`: 완성됐는지 알 수 없으므로 지운다
/// - `.old-*`: `<id>`가 없으면(바꿔 끼우기 전에 꺼짐) 되돌리고, 있으면 지운다
pub fn recover(user_modes: &Path) {
    let _g = install_lock();
    recover_matching(user_modes, None);
}

fn recover_id(user_modes: &Path, id: &str) {
    recover_matching(user_modes, Some(id));
}

fn recover_matching(user_modes: &Path, only: Option<&str>) {
    let Ok(rd) = std::fs::read_dir(user_modes) else { return };
    let mut names: Vec<String> = rd.flatten().filter_map(|e| e.file_name().into_string().ok()).collect();
    names.sort();
    // id별 .old-* 후보: (mtime, 이름)
    let mut olds: std::collections::BTreeMap<String, Vec<(std::time::SystemTime, PathBuf)>> = Default::default();
    for name in &names {
        let Some((id, is_old)) = leftover(name) else { continue };
        if only.is_some_and(|o| o != id) {
            continue;
        }
        let p = user_modes.join(name);
        let mtime = match std::fs::symlink_metadata(&p) {
            Ok(md) if md.is_dir() && !md.file_type().is_symlink() => md.modified().unwrap_or(std::time::UNIX_EPOCH),
            _ => continue,
        };
        if is_old {
            olds.entry(id.to_string()).or_default().push((mtime, p));
        } else {
            std::fs::remove_dir_all(&p).ok();
        }
    }
    for (id, mut list) in olds {
        let dst = user_modes.join(&id);
        // <id>가 없으면 가장 최근 백업(mtime, 같으면 이름이 큰 것) 하나만 되돌리고 나머지는 지운다
        list.sort();
        if std::fs::symlink_metadata(&dst).is_err() {
            if let Some((_, newest)) = list.pop() {
                if std::fs::rename(&newest, &dst).is_err() {
                    // 되돌리지 못했으면 다른 백업도 지우지 않는다 (다음 실행 때 다시 시도)
                    continue;
                }
            }
        }
        for (_, p) in list {
            std::fs::remove_dir_all(&p).ok();
        }
    }
}

fn chrono_now() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

pub fn remove(user_modes: &Path, id: &str) -> Result<(), String> {
    let _g = install_lock();
    if !id_ok(id) {
        return err("잘못된 모드 id");
    }
    let p = user_modes.join(id);
    let md = std::fs::symlink_metadata(&p).map_err(|_| "설치된 모드가 아니에요".to_string())?;
    if md.file_type().is_symlink() || !md.is_dir() {
        return err("폴더가 아니라 지우지 않았어요");
    }
    let base = std::fs::canonicalize(user_modes).map_err(|e| e.to_string())?;
    let full = std::fs::canonicalize(&p).map_err(|e| e.to_string())?;
    if full.parent() != Some(base.as_path()) {
        return err("사용자 모드 폴더 밖이에요");
    }
    std::fs::remove_dir_all(&full).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("ws-mi-{name}-{}", std::process::id()));
        std::fs::remove_dir_all(&d).ok();
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn write_pkg(d: &Path, id: &str) {
        std::fs::create_dir_all(d.join("assets")).unwrap();
        std::fs::write(
            d.join("mode.json"),
            format!(r#"{{"id":"{id}","name":"Demo","version":"1.0.0","apiVersion":"1.0","needs":["memo"]}}"#),
        )
        .unwrap();
        std::fs::write(d.join("mode.js"), "Core.registerMode({id:'x',mount(){}})").unwrap();
        std::fs::write(d.join("assets/a.svg"), "<svg/>").unwrap();
        std::fs::write(d.join(".DS_Store"), "junk").unwrap();
    }

    fn zip_of(path: &Path, entries: &[(&str, &[u8])]) {
        let f = std::fs::File::create(path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        for (n, b) in entries {
            z.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
            z.write_all(b).unwrap();
        }
        z.finish().unwrap();
    }

    #[test]
    fn folder_install_update_remove() {
        let t = tmp("folder");
        let src = t.join("src");
        write_pkg(&src, "demo");
        let modes = t.join("modes");
        let st = prepare(&src, &t.join("stage"), &["hamster".into()], &modes, "ko").unwrap();
        assert_eq!(st.id, "demo");
        assert_eq!(st.info["files"], 3);
        assert_eq!(st.info["addedNeeds"], json!(["memo"]));
        commit(&st, &modes).unwrap();
        assert!(modes.join("demo/mode.js").is_file() && modes.join("demo/.install.json").is_file());
        // 설치 기록의 SHA-256은 소문자 16진 64자 (sha2 0.11에서 출력 방식을 바꿔도 예전 기록과 같은 값)
        let rec: Value = serde_json::from_slice(&std::fs::read(modes.join("demo/.install.json")).unwrap()).unwrap();
        assert_eq!(
            rec["sha256"]["assets/a.svg"],
            "d4dc56669143034f31aa309635d4113d9ad76a02b1739da22c965ed2049be9e6"
        );
        assert!(!modes.join("demo/.DS_Store").exists());
        let st2 = prepare(&src, &t.join("stage"), &[], &modes, "ko").unwrap();
        assert_eq!(st2.info["replaces"], "1.0.0");
        assert_eq!(st2.info["addedNeeds"], json!([]));
        commit(&st2, &modes).unwrap();
        remove(&modes, "demo").unwrap();
        assert!(!modes.join("demo").exists());
        assert!(remove(&modes, "../x").is_err());
        // 내장 id 충돌
        write_pkg(&t.join("h"), "hamster");
        assert!(prepare(&t.join("h"), &t.join("stage"), &["hamster".into()], &modes, "ko")
            .unwrap_err()
            .contains("내장"));
        std::fs::remove_dir_all(t).ok();
    }

    #[test]
    fn entry_and_styles_paths_checked() {
        let t = tmp("paths");
        let modes = t.join("modes");
        std::fs::write(t.join("outside.js"), "1").unwrap();
        let mk = |name: &str, extra: &str| {
            let d = t.join(name);
            write_pkg(&d, "pp");
            std::fs::write(d.join("a.css"), "a{}").unwrap();
            std::fs::write(
                d.join("mode.json"),
                format!(r#"{{"id":"pp","name":"P","version":"1.0.0","apiVersion":"1.0",{extra}}}"#),
            )
            .unwrap();
            d
        };
        let run = |d: &Path| prepare(d, &t.join("stage"), &[], &modes, "ko");
        assert!(run(&mk("ok", r#""entry":"mode.js","styles":["a.css"]"#)).is_ok());
        for (n, extra) in [
            ("e1", r#""entry":"../outside.js""#),
            ("e2", r#""entry":"sub/../mode.js""#),
            ("e3", r#""entry":"/etc/x.js""#),
            ("e4", r#""entry":5"#),
            ("s1", r#""styles":["../bad.css"]"#),
            ("s2", r#""styles":["nope.css"]"#),
            ("s3", r#""styles":["a.js"]"#),
            ("s4", r#""styles":"a.css""#),
        ] {
            assert!(run(&mk(n, extra)).is_err(), "{extra}");
        }
        std::fs::remove_dir_all(t).ok();
    }

    #[test]
    fn zip_rules() {
        let t = tmp("zip");
        let modes = t.join("modes");
        let mj = br#"{"id":"zz","name":"Z","version":"0.1.0","needs":[]}"#;
        let ok = t.join("ok.zip");
        zip_of(&ok, &[("zz/mode.json", mj), ("zz/mode.js", b"1"), ("__MACOSX/zz/._mode.js", b"x")]);
        let st = prepare(&ok, &t.join("stage"), &[], &modes, "en").unwrap();
        assert_eq!(st.id, "zz");
        for (name, entries) in [
            ("slip", vec![("../evil.js", &b"1"[..]), ("mode.json", mj), ("mode.js", b"1")]),
            ("abs", vec![("/tmp/evil.js", &b"1"[..]), ("mode.json", mj), ("mode.js", b"1")]),
            ("ext", vec![("mode.json", mj), ("mode.js", b"1"), ("run.sh", b"rm")]),
            ("html", vec![("mode.json", mj), ("mode.js", b"1"), ("page.html", b"<x>")]),
            (
                "perm",
                vec![
                    ("mode.json", &br#"{"id":"zz","name":"Z","version":"0.1.0","needs":["fs"]}"#[..]),
                    ("mode.js", b"1"),
                ],
            ),
            ("noentry", vec![("mode.json", mj)]),
        ] {
            let p = t.join(format!("{name}.zip"));
            zip_of(&p, &entries);
            let e = prepare(&p, &t.join("stage"), &[], &modes, "en").expect_err(name);
            // 경로 탈출은 진입 파일이 있어도 경로 규칙으로 거부돼야 한다
            assert!(!matches!(name, "slip" | "abs") || e.contains("경로"), "{name}: {e}");
            assert!(!t.join("evil.js").exists() && !Path::new("/tmp/evil.js").exists());
        }
        {
            // zip 안의 심볼릭 링크 항목
            let p = t.join("zln.zip");
            let mut z = zip::ZipWriter::new(std::fs::File::create(&p).unwrap());
            let o = zip::write::SimpleFileOptions::default();
            for (n, b) in [("mode.json", &mj[..]), ("mode.js", b"1")] {
                z.start_file(n, o).unwrap();
                z.write_all(b).unwrap();
            }
            z.add_symlink("assets/h.txt", "/etc/hosts", o).unwrap();
            z.finish().unwrap();
            assert!(prepare(&p, &t.join("stage"), &[], &modes, "en").unwrap_err().contains("링크"));
        }
        #[cfg(unix)]
        {
            let src = t.join("ln");
            write_pkg(&src, "ln");
            std::os::unix::fs::symlink("/etc/hosts", src.join("assets/h.txt")).unwrap();
            assert!(prepare(&src, &t.join("stage"), &[], &modes, "en").unwrap_err().contains("링크"));
        }
        std::fs::remove_dir_all(t).ok();
    }

    fn version_of(d: &Path) -> String {
        let m: Value = serde_json::from_slice(&std::fs::read(d.join("mode.json")).unwrap()).unwrap();
        m["version"].as_str().unwrap().to_string()
    }

    fn leftovers(modes: &Path) -> Vec<String> {
        let mut v: Vec<String> = std::fs::read_dir(modes)
            .unwrap()
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .filter(|n| n.starts_with('.'))
            .collect();
        v.sort();
        v
    }

    fn fail(steps: &[&'static str]) {
        FAIL_STEP.with(|f| *f.borrow_mut() = steps.to_vec());
    }

    #[test]
    fn update_failure_keeps_old_version() {
        let t = tmp("upd");
        let modes = t.join("modes");
        let v1 = t.join("v1");
        write_pkg(&v1, "demo");
        commit(&prepare(&v1, &t.join("stage"), &[], &modes, "ko").unwrap(), &modes).unwrap();
        let v2 = t.join("v2");
        write_pkg(&v2, "demo");
        std::fs::write(v2.join("mode.json"), r#"{"id":"demo","name":"Demo","version":"2.0.0","needs":[]}"#).unwrap();

        // 바꿔 끼우기 실패 → 기존 판 복구, 흔적 없음
        for s in ["swap", "backup"] {
            let st = prepare(&v2, &t.join("stage"), &[], &modes, "ko").unwrap();
            fail(&[s]);
            let e = commit(&st, &modes).unwrap_err();
            fail(&[]);
            assert!(e.contains("기존 모드"), "{s}: {e}");
            assert_eq!(version_of(&modes.join("demo")), "1.0.0", "{s}");
            assert!(modes.join("demo/mode.js").is_file());
            assert!(leftovers(&modes).is_empty(), "{s}: {:?}", leftovers(&modes));
            std::fs::remove_dir_all(&st.dir).ok();
        }

        // 새로 설치하다 실패해도 흔적이 남지 않는다
        let n = t.join("n");
        write_pkg(&n, "fresh");
        let st = prepare(&n, &t.join("stage"), &[], &modes, "ko").unwrap();
        fail(&["swap"]);
        assert!(commit(&st, &modes).is_err());
        fail(&[]);
        assert!(!modes.join("fresh").exists() && leftovers(&modes).is_empty());

        // 스테이징 rename 실패(다른 볼륨 흉내) → 복사로 대신해 업데이트 성공, 기존 판 백업은 지워진다
        let st = prepare(&v2, &t.join("stage"), &[], &modes, "ko").unwrap();
        fail(&["stage"]);
        commit(&st, &modes).unwrap();
        fail(&[]);
        assert_eq!(version_of(&modes.join("demo")), "2.0.0");
        assert!(modes.join("demo/assets/a.svg").is_file() && modes.join("demo/.install.json").is_file());
        assert!(leftovers(&modes).is_empty(), "{:?}", leftovers(&modes));
        std::fs::remove_dir_all(t).ok();
    }

    #[test]
    fn recover_restores_or_cleans_leftovers() {
        let t = tmp("recover");
        let modes = t.join("modes");
        let mk = |name: &str, ver: &str| {
            let d = modes.join(name);
            std::fs::create_dir_all(&d).unwrap();
            std::fs::write(d.join("mode.json"), format!(r#"{{"version":"{ver}"}}"#)).unwrap();
        };
        // a: 비켜 둔 뒤 꺼짐(a 없음) → 되돌림, 미완성 새 판은 지움
        mk(".a.old-1f", "1.0.0");
        mk(".a.new-2f", "2.0.0");
        // b: 바꿔 끼운 뒤 꺼짐(b 있음) → 백업 지움
        mk("b", "2.0.0");
        mk(".b.old-3", "1.0.0");
        // 형식이 다른 이름은 건드리지 않는다
        for keep in [".c.old-zz", ".c.old-", ".Bad.old-1", ".c.bak-1", ".hidden", "c.old-1"] {
            mk(keep, "9.9.9");
        }
        std::fs::write(modes.join(".d.old-1"), "file").unwrap();
        recover(&modes);
        assert_eq!(version_of(&modes.join("a")), "1.0.0");
        assert_eq!(version_of(&modes.join("b")), "2.0.0");
        for gone in [".a.old-1f", ".a.new-2f", ".b.old-3"] {
            assert!(!modes.join(gone).exists(), "{gone}");
        }
        for keep in [".c.old-zz", ".c.old-", ".Bad.old-1", ".c.bak-1", ".hidden", "c.old-1", ".d.old-1"] {
            assert!(modes.join(keep).exists(), "{keep}");
        }
        // 같은 id의 백업이 여럿이고 <id>가 없으면 가장 최근 것 하나만 되돌리고 나머지는 지운다
        // (폴더 mtime을 File::open으로 바꾸는 건 unix에서만 된다. 앱 테스트는 Linux·macOS에서 돈다)
        #[cfg(unix)]
        {
            mk(".f.old-a1", "1.0.0");
            mk(".f.old-b2", "3.0.0");
            mk(".f.old-c3", "2.0.0");
            let at = |name: &str, secs: u64| {
                let t = std::time::UNIX_EPOCH + std::time::Duration::from_secs(secs);
                std::fs::File::open(modes.join(name)).unwrap().set_modified(t).unwrap();
            };
            at(".f.old-a1", 1_000);
            at(".f.old-b2", 3_000);
            at(".f.old-c3", 2_000);
            // mtime이 같으면 이름이 큰 쪽
            mk(".g.old-1", "1.0.0");
            mk(".g.old-2", "2.0.0");
            at(".g.old-1", 5_000);
            at(".g.old-2", 5_000);
            recover(&modes);
            assert_eq!(version_of(&modes.join("f")), "3.0.0");
            assert_eq!(version_of(&modes.join("g")), "2.0.0");
            for gone in [".f.old-a1", ".f.old-b2", ".f.old-c3", ".g.old-1", ".g.old-2"] {
                assert!(!modes.join(gone).exists(), "{gone}");
            }
        }
        #[cfg(unix)]
        {
            // 링크는 따라가지도 지우지도 않는다
            let target = t.join("target");
            std::fs::create_dir_all(&target).unwrap();
            std::fs::write(target.join("keep.txt"), "x").unwrap();
            std::os::unix::fs::symlink(&target, modes.join(".e.old-1")).unwrap();
            recover(&modes);
            assert!(target.join("keep.txt").is_file() && !modes.join("e").exists());
        }
        std::fs::remove_dir_all(t).ok();
    }

    #[test]
    fn budget_rejects_overflow() {
        let mut b = Budget { files: 0, bytes: 0 };
        b.add(10).unwrap();
        // 릴리스 빌드(overflow-checks 꺼짐)였다면 10 + u64::MAX - 5 = 4로 감겨 통과했을 크기
        assert!(b.add(u64::MAX - 5).is_err());
        assert!(b.add(u64::MAX).is_err());
        assert_eq!(b.bytes, 10);
        b.add(MAX_BYTES - 10).unwrap();
        assert!(b.add(1).is_err());
        let mut f = Budget {
            files: MAX_FILES,
            bytes: 0,
        };
        assert!(f.add(0).unwrap_err().contains("파일"));
    }

    #[test]
    fn windows_junk_files_skipped() {
        assert!(skip_name("desktop.ini") && skip_name("Desktop.INI") && skip_name("a/Thumbs.db") && skip_name("THUMBS.DB"));
        assert!(!skip_name("mode.js") && !skip_name("thumbs.dbx"));
        let t = tmp("winjunk");
        let modes = t.join("modes");
        let src = t.join("src");
        write_pkg(&src, "wj");
        std::fs::write(src.join("desktop.ini"), "[.ShellClassInfo]").unwrap();
        std::fs::write(src.join("assets/Thumbs.db"), "x").unwrap();
        std::fs::write(src.join("assets/DESKTOP.INI"), "x").unwrap();
        let st = prepare(&src, &t.join("stage"), &[], &modes, "ko").unwrap();
        assert_eq!(st.info["files"], 3);
        commit(&st, &modes).unwrap();
        assert!(!modes.join("wj/desktop.ini").exists() && !modes.join("wj/assets/Thumbs.db").exists());
        let z = t.join("wj.zip");
        let mj = br#"{"id":"wz","name":"Z","version":"0.1.0","needs":[]}"#;
        zip_of(
            &z,
            &[
                ("wz/mode.json", mj),
                ("wz/mode.js", b"1"),
                ("wz/desktop.ini", b"x"),
                ("wz/assets/Thumbs.db", b"x"),
            ],
        );
        let st = prepare(&z, &t.join("stage"), &[], &modes, "en").unwrap();
        assert_eq!(st.info["files"], 2);
        std::fs::remove_dir_all(t).ok();
    }
}
