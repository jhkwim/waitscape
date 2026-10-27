//! JSON Lines 증분 읽기 (공통). 개행으로 끝난 줄만 넘기고, 개행 없는 마지막 줄(쓰는 중)은 다음 읽기로 미룬다.

use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::Path;

/// 파일 크기 (없으면 None)
pub fn size(path: &Path) -> Option<u64> {
    std::fs::metadata(path).ok().map(|m| m.len())
}

/// `off`부터 완성된 줄을 하나씩 `f`에 넘기고 `off`를 전진시킨다. 줄에는 끝의 `\n`이 포함된다.
pub fn read_lines(path: &Path, off: &mut u64, mut f: impl FnMut(&[u8])) -> std::io::Result<()> {
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(*off))?;
    let mut r = BufReader::with_capacity(1 << 20, file);
    let mut buf = Vec::with_capacity(1 << 16);
    loop {
        buf.clear();
        let n = r.read_until(b'\n', &mut buf)?;
        if n == 0 || buf.last() != Some(&b'\n') {
            break;
        }
        *off += n as u64;
        f(&buf);
    }
    Ok(())
}

/// 바이트 부분 문자열 검색
pub fn contains(hay: &[u8], needle: &[u8]) -> bool {
    if needle.is_empty() {
        return true;
    }
    let first = needle[0];
    let mut i = 0;
    while i + needle.len() <= hay.len() {
        match hay[i..hay.len() - needle.len() + 1].iter().position(|&b| b == first) {
            None => return false,
            Some(p) => {
                i += p;
                if &hay[i..i + needle.len()] == needle {
                    return true;
                }
                i += 1;
            }
        }
    }
    false
}

/// server.py `TYPE_RE` = `"type": ?"(assistant|user)"` 를 줄 앞뒤 4000바이트에서 찾는다
pub fn has_type_marker(raw: &[u8]) -> bool {
    fn find(h: &[u8]) -> bool {
        let pat = b"\"type\":";
        let mut i = 0;
        while i + pat.len() <= h.len() {
            if &h[i..i + pat.len()] == pat {
                let mut j = i + pat.len();
                if h.get(j) == Some(&b' ') {
                    j += 1;
                }
                let rest = &h[j..];
                if rest.starts_with(b"\"assistant\"") || rest.starts_with(b"\"user\"") {
                    return true;
                }
            }
            i += 1;
        }
        false
    }
    let head = &raw[..raw.len().min(4000)];
    let tail = &raw[raw.len().saturating_sub(4000)..];
    find(head) || find(tail)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers() {
        assert!(contains(b"abc\"user\"x", b"\"user\""));
        assert!(!contains(b"abc", b"abcd"));
        assert!(has_type_marker(br#"{"type": "user"}"#));
        assert!(has_type_marker(br#"{"type":"assistant"}"#));
        assert!(!has_type_marker(br#"{"type":"summary"}"#));
    }

    #[test]
    fn partial_line_waits() {
        let dir = std::env::temp_dir().join(format!("wr-jsonl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("a.jsonl");
        std::fs::write(&p, b"{\"a\":1}\n{\"b\":").unwrap();
        let mut off = 0;
        let mut n = 0;
        read_lines(&p, &mut off, |_| n += 1).unwrap();
        assert_eq!((n, off), (1, 8));
        std::fs::write(&p, b"{\"a\":1}\n{\"b\":2}\n").unwrap();
        read_lines(&p, &mut off, |l| assert_eq!(l, b"{\"b\":2}\n")).unwrap();
        assert_eq!(off, 16);
        std::fs::remove_dir_all(&dir).ok();
    }
}
