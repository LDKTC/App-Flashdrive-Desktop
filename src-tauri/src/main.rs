#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
};
use tauri::{Manager, PhysicalPosition, PhysicalSize, State, WebviewWindow};

const APP_EXT: &[&str] = &["exe", "lnk", "bat", "cmd", "url", "appimage", "app"];
const IMG_EXT: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp"];
const AUDIO_EXT: &[&str] = &["mp3", "m4a", "aac", "wav", "ogg", "oga", "flac", "opus"];
const VIDEO_EXT: &[&str] = &["mp4", "m4v", "webm", "mov", "mkv", "ogv"];
const DOC_EXT: &[&str] = &["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "rtf", "odt", "ods", "odp", "csv", "json", "html", "htm"];
const ARCHIVE_EXT: &[&str] = &["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso"];
const SKIP_DIR: &[&str] = &["node_modules", "$recycle.bin", "system volume information"];
// ponytail: name heuristic to hide installer/helper exes; tune the list if real apps get hidden
const NOT_APP: &[&str] = &["unins", "setup", "update", "crash", "helper", "install"];

struct Drive {
    root: PathBuf,
    settings_file: PathBuf,
    root_canon: PathBuf, // for the "inside the drive" check
    normal: Mutex<Option<(PhysicalPosition<i32>, PhysicalSize<u32>, bool)>>, // position, inner size, maximized before folding
}

#[derive(Serialize)]
struct AppItem {
    name: String,
    path: String,
}

#[derive(Serialize)]
struct Media {
    name: String,
    path: String,
    rel: String,   // path relative to the drive root: stays valid when the drive letter changes
    dir: String,   // folder = album
    album: String,
}

fn ext_of(p: &Path) -> String {
    p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// The page may only touch paths inside the drive (resolves `..` and links first).
/// A path inside a zip ("D:\a.zip\pics\x.jpg") counts as its zip file.
fn inside(d: &Drive, p: &Path) -> bool {
    let zip = split_archive(p).map(|(z, _)| z);
    fs::canonicalize(zip.as_deref().unwrap_or(p)).map(|c| c.starts_with(&d.root_canon)).unwrap_or(false)
}

fn category(p: &Path) -> &'static str {
    let e = ext_of(p);
    let e = e.as_str();
    [(IMG_EXT, "image"), (AUDIO_EXT, "audio"), (VIDEO_EXT, "video"), (APP_EXT, "app"), (DOC_EXT, "document"), (ARCHIVE_EXT, "archive")]
        .iter()
        .find(|(exts, _)| exts.contains(&e))
        .map_or("other", |(_, c)| c)
}

fn rel_of(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

/// Files under `dir` with an extension in `exts`, `depth` folders deep, at most `limit`.
/// A folder with a matching extension (macOS .app bundle) counts as one item.
fn scan(dir: &Path, exts: &[&str], depth: u32, limit: usize, out: &mut Vec<PathBuf>) {
    let Ok(rd) = fs::read_dir(dir) else { return };
    let mut entries: Vec<_> = rd.flatten().collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        if out.len() >= limit {
            return;
        }
        let p = e.path();
        let name = e.file_name().to_string_lossy().to_lowercase();
        let matched = exts.contains(&ext_of(&p).as_str());
        let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
        // dot names are hidden: also skips macOS "._photo.jpg" AppleDouble junk (4 KB, not an image)
        if name.starts_with('.') {
            continue;
        }
        if is_dir && !matched {
            if depth > 0 && !SKIP_DIR.contains(&name.as_str()) {
                scan(&p, exts, depth - 1, limit, out);
            }
        } else if matched && !(exts == APP_EXT && NOT_APP.iter().any(|w| name.contains(w))) {
            out.push(p);
        }
    }
}

fn media(root: &Path, exts: &[&str], depth: u32) -> Vec<Media> {
    let mut found = vec![];
    // ponytail: original files used as thumbnails (lazy-loaded); generate thumbnails if huge drives get slow
    scan(root, exts, depth, 5000, &mut found);
    found
        .into_iter()
        .map(|p| {
            let dir = p.parent().unwrap_or(root).to_path_buf();
            let album = match dir.file_name() {
                Some(n) if dir != root => n.to_string_lossy().into_owned(),
                _ => root.display().to_string(),
            };
            Media {
                name: p.file_name().unwrap_or_default().to_string_lossy().into_owned(),
                rel: rel_of(root, &p),
                path: p.display().to_string(),
                dir: dir.display().to_string(),
                album,
            }
        })
        .collect()
}

#[tauri::command]
fn info(d: State<Drive>) -> String {
    d.root.display().to_string()
}

#[tauri::command]
async fn apps(d: State<'_, Drive>) -> Result<Vec<AppItem>, String> {
    let me = std::env::current_exe().ok().and_then(|p| fs::canonicalize(p).ok());
    let mut found = vec![];
    scan(&d.root, APP_EXT, 2, 300, &mut found);
    Ok(found
        .into_iter()
        .filter(|p| fs::canonicalize(p).ok() != me)
        .map(|p| AppItem {
            name: p.file_stem().unwrap_or_default().to_string_lossy().into_owned(),
            path: p.display().to_string(),
        })
        .collect())
}

fn media_cmd(d: &Drive, exts: &[&str]) -> Vec<Media> {
    media(&d.root, exts, 6)
}

#[tauri::command]
async fn images(d: State<'_, Drive>) -> Result<Vec<Media>, String> {
    Ok(media_cmd(&d, IMG_EXT))
}

#[tauri::command]
async fn music(d: State<'_, Drive>) -> Result<Vec<Media>, String> {
    Ok(media_cmd(&d, AUDIO_EXT))
}

#[tauri::command]
async fn videos(d: State<'_, Drive>) -> Result<Vec<Media>, String> {
    Ok(media_cmd(&d, VIDEO_EXT))
}

/// Launch an app, open a file with the computer's default program, or a folder in the file manager.
/// A file inside a zip is first copied out to the temp folder.
#[tauri::command]
async fn open(path: String, d: State<'_, Drive>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if !inside(&d, &p) {
        return Err("not allowed".into());
    }
    let p = match split_archive(&p) {
        Some((z, inner)) if !inner.is_empty() => {
            let tmp = std::env::temp_dir().join("FlashdriveHome");
            tauri::async_runtime::spawn_blocking(move || extract_entry(&z, &inner, &tmp)).await.map_err(|e| e.to_string())??
        }
        _ => p,
    };
    let cwd = if p.is_dir() { p.clone() } else { p.parent().unwrap_or(&d.root).to_path_buf() };
    #[cfg(windows)]
    {
        // run .exe directly so portable apps start in their own folder; explorer handles the rest
        // (and elevated exes, which fail a direct spawn)
        if ext_of(&p) == "exe" && Command::new(&p).current_dir(&cwd).spawn().is_ok() {
            return Ok(());
        }
        Command::new("explorer").arg(&p).current_dir(&cwd).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let opener = if cfg!(target_os = "macos") { "open" } else { "xdg-open" };
        Command::new(opener).arg(&p).current_dir(&cwd).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Real file icons (PNG data URLs) for app paths; None where unavailable.
#[tauri::command]
async fn icons(paths: Vec<String>, d: State<'_, Drive>) -> Result<Vec<Option<String>>, String> {
    let ok: Vec<bool> = paths.iter().map(|p| inside(&d, Path::new(p))).collect();
    tauri::async_runtime::spawn_blocking(move || {
        #[cfg(windows)]
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_APARTMENTTHREADED);
        }
        paths.iter().zip(ok).map(|(p, ok)| if ok { icon_png(p, 96) } else { None }).collect()
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(windows)]
fn icon_png(path: &str, size: i32) -> Option<String> {
    use base64::Engine;
    use windows::{
        core::HSTRING,
        Win32::{Foundation::SIZE, Graphics::Gdi::*, UI::Shell::*},
    };
    unsafe {
        // same icon Explorer shows, at the requested size
        let factory: IShellItemImageFactory = SHCreateItemFromParsingName(&HSTRING::from(path), None).ok()?;
        let hbmp = factory.GetImage(SIZE { cx: size, cy: size }, SIIGBF_ICONONLY).ok()?;
        let mut bm = BITMAP::default();
        GetObjectW(hbmp.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as _));
        let (w, h) = (bm.bmWidth, bm.bmHeight);
        let mut bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down rows
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut px = vec![0u8; (w * h * 4) as usize];
        let dc = GetDC(None);
        let rows = GetDIBits(dc, hbmp, 0, h as u32, Some(px.as_mut_ptr() as _), &mut bmi, DIB_RGB_COLORS);
        ReleaseDC(None, dc);
        let _ = DeleteObject(hbmp.into());
        if rows == 0 || w <= 0 || h <= 0 {
            return None;
        }
        // BGRA premultiplied -> RGBA straight alpha
        for c in px.chunks_exact_mut(4) {
            let a = c[3] as u32;
            let un = |v: u8| if a == 0 { v } else { (v as u32 * 255 / a).min(255) as u8 };
            let (b, g, r) = (un(c[0]), un(c[1]), un(c[2]));
            c[0] = r;
            c[1] = g;
            c[2] = b;
        }
        let mut out = vec![];
        {
            let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            enc.write_header().ok()?.write_image_data(&px).ok()?;
        }
        Some(format!("data:image/png;base64,{}", base64::engine::general_purpose::STANDARD.encode(out)))
    }
}

#[cfg(not(windows))]
fn icon_png(_path: &str, _size: i32) -> Option<String> {
    None // page falls back to a letter icon
}

/// Screen area in physical pixels: x, y, width, height.
type Area = (i32, i32, i32, i32);

/// Top-left of a `w`x`h` overlay anchored at `pos` inside `wa`, `gap` from the edges.
/// pos: "tl" "tr" "bl" "br" (corners) or "l" "r" (middle of the left/right edge).
fn anchor_xy(wa: Area, w: i32, h: i32, gap: i32, pos: &str) -> (i32, i32) {
    let (ax, ay, aw, ah) = wa;
    let x = if pos.ends_with('l') { ax + gap } else { ax + aw - w - gap };
    let y = match pos.chars().next() {
        Some('t') => ay + gap,
        Some('b') => ay + ah - h - gap,
        _ => ay + (ah - h) / 2,
    };
    (x, y)
}

/// x for an overlay tucked into its side edge (`hide`, leaving a `peek`-px strip) or shown.
fn peek_x(wa: Area, w: i32, gap: i32, peek: i32, pos: &str, hide: bool) -> i32 {
    let (ax, _, aw, _) = wa;
    match (pos.ends_with('l'), hide) {
        (true, true) => ax - w + peek,
        (true, false) => ax + gap,
        (false, true) => ax + aw - peek,
        (false, false) => ax + aw - w - gap,
    }
}

fn work_area(window: &WebviewWindow) -> Result<Option<(f64, Area)>, tauri::Error> {
    Ok(window.current_monitor()?.map(|m| {
        let wa = m.work_area(); // screen minus taskbar
        (m.scale_factor(), (wa.position.x, wa.position.y, wa.size.width as i32, wa.size.height as i32))
    }))
}

/// Fold the window into an always-on-top mini player anchored at `pos`, or restore it.
/// Same window and page, so playback keeps going. `w`/`h` = overlay size in CSS pixels.
#[tauri::command]
fn set_mini(mini: bool, w: f64, h: f64, pos: String, window: WebviewWindow, d: State<Drive>) -> Result<(), tauri::Error> {
    let mut normal = d.normal.lock().unwrap();
    if mini {
        if normal.is_none() {
            *normal = Some((window.outer_position()?, window.inner_size()?, window.is_maximized()?));
        }
        window.unmaximize()?;
        window.set_decorations(false)?;
        window.set_always_on_top(true)?;
        if let Some((s, wa)) = work_area(&window)? {
            let (w, h) = ((w.clamp(200.0, 800.0) * s) as i32, (h.clamp(80.0, 700.0) * s) as i32);
            window.set_size(PhysicalSize::new(w as u32, h as u32))?;
            let (x, y) = anchor_xy(wa, w, h, (12.0 * s) as i32, &pos);
            window.set_position(PhysicalPosition::new(x, y))?;
        }
        window.set_resizable(false)?; // after set_size: GTK ignores resizes of a non-resizable window
    } else if let Some((pos, size, maximized)) = normal.take() {
        window.set_resizable(true)?;
        window.set_always_on_top(false)?;
        window.set_decorations(true)?;
        if size.width > 0 && size.height > 0 {
            window.set_size(size)?;
        } else {
            window.set_size(tauri::LogicalSize::new(1280.0, 800.0))?; // size unknown (some X11 setups)
        }
        window.set_position(pos)?;
        if maximized {
            window.maximize()?;
        }
    }
    Ok(())
}

/// Slide the folded overlay into its side edge (hide) or back out, keeping its current height
/// on screen (so a vertical drag is kept).
#[tauri::command]
fn mini_peek(hide: bool, pos: String, window: WebviewWindow) -> Result<(), tauri::Error> {
    if let Some((s, wa)) = work_area(&window)? {
        let w = window.inner_size()?.width as i32;
        let y = window.outer_position()?.y;
        let x = peek_x(wa, w, (12.0 * s) as i32, (14.0 * s) as i32, &pos, hide);
        window.set_position(PhysicalPosition::new(x, y))?;
    }
    Ok(())
}

// ---------- file browser ----------

#[derive(Serialize)]
struct Entry {
    name: String,
    path: String,
    rel: String,
    dir: bool,
    size: u64, // files only; folder sizes come from dir_stats
    modified: Option<u64>, // unix seconds
    kind: &'static str, // "folder" or a category
    arc: bool, // inside a zip: served by the arc:// protocol, not asset://
}

#[derive(Serialize)]
struct Listing {
    path: String,
    crumbs: Vec<(String, String)>, // (name, path) from the drive root down to this folder
    entries: Vec<Entry>,
}

fn list(root: &Path, dir: &Path) -> std::io::Result<Listing> {
    let mut entries = vec![];
    for e in fs::read_dir(dir)?.flatten() {
        let Ok(md) = e.metadata() else { continue };
        let p = e.path();
        entries.push(Entry {
            name: e.file_name().to_string_lossy().into_owned(),
            rel: rel_of(root, &p),
            dir: md.is_dir(),
            size: if md.is_dir() { 0 } else { md.len() },
            modified: md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()),
            kind: if md.is_dir() { "folder" } else { category(&p) },
            path: p.display().to_string(),
            arc: false,
        });
    }
    Ok(Listing { path: dir.display().to_string(), crumbs: crumbs(root, dir), entries })
}

/// (name, path) from the drive root down to `dir`.
fn crumbs(root: &Path, dir: &Path) -> Vec<(String, String)> {
    let mut c: Vec<_> = dir
        .ancestors()
        .take_while(|a| a.starts_with(root))
        .map(|a| {
            let name = if a == root { root.display().to_string() } else { a.file_name().unwrap_or_default().to_string_lossy().into_owned() };
            (name, a.display().to_string())
        })
        .collect();
    c.reverse();
    c
}

#[tauri::command]
async fn list_dir(path: String, d: State<'_, Drive>) -> Result<Listing, String> {
    let p = PathBuf::from(&path);
    if !inside(&d, &p) {
        return Err("not allowed".into());
    }
    let root = d.root.clone();
    tauri::async_runtime::spawn_blocking(move || match split_archive(&p) {
        Some((z, inner)) => Ok(list_archive(&root, &z, &inner, &zip_files(&z)?)),
        None => list(&root, &p).map_err(|e| e.to_string()),
    })
    .await
    .map_err(|e| e.to_string())?
}

// ---------- zip files, browsed like folders: "D:\a.zip\pics\x.jpg" ----------

/// (zip file, entry path inside it with '/') for a path in or at a zip; the zip itself gives "".
fn split_archive(p: &Path) -> Option<(PathBuf, String)> {
    let z = p.ancestors().find(|a| ext_of(a) == "zip" && a.is_file())?;
    let inner: Vec<_> = p.strip_prefix(z).ok()?.components().map(|c| c.as_os_str().to_string_lossy().into_owned()).collect();
    Some((z.to_path_buf(), inner.join("/")))
}

/// `z` + "a/b/c" as a normal path ("D:\x.zip\a\b\c").
fn under(z: &Path, inner: &str) -> PathBuf {
    inner.split('/').filter(|s| !s.is_empty()).fold(z.to_path_buf(), |p, s| p.join(s))
}

fn open_zip(z: &Path) -> Result<zip::ZipArchive<fs::File>, String> {
    zip::ZipArchive::new(fs::File::open(z).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Entry name with '/' separators (zips made on Windows sometimes use '\').
fn zip_name(n: &str) -> String {
    n.replace('\\', "/").trim_start_matches('/').to_string()
}

/// (entry path, size) of every file in the zip; folders are implied by the paths.
/// Names with "." / ".." parts are left out of the listing (they'd point outside the zip).
// ponytail: re-reads the zip's directory each call; cache per zip if huge archives feel slow
fn zip_files(z: &Path) -> Result<Vec<(String, u64)>, String> {
    let mut a = open_zip(z)?;
    Ok((0..a.len())
        .filter_map(|i| a.by_index_raw(i).ok().filter(|f| !f.is_dir()).map(|f| (zip_name(f.name()), f.size())))
        .filter(|(n, _)| !n.split('/').any(|s| s == ".." || s == "."))
        .collect())
}

fn list_archive(root: &Path, z: &Path, inner: &str, files: &[(String, u64)]) -> Listing {
    let pre = if inner.is_empty() { String::new() } else { format!("{inner}/") };
    let base = under(z, inner);
    let mut seen = std::collections::HashSet::new();
    let mut entries = vec![];
    for (name, size) in files {
        let Some(rest) = name.strip_prefix(&pre) else { continue };
        let (n, dir) = match rest.split_once('/') {
            Some((d, _)) => (d, true),
            None => (rest, false),
        };
        if n.is_empty() || !seen.insert((n, dir)) {
            continue;
        }
        let p = base.join(n);
        entries.push(Entry {
            name: n.to_string(),
            rel: rel_of(root, &p),
            dir,
            size: if dir { 0 } else { *size },
            modified: None,
            kind: if dir { "folder" } else { category(&p) },
            path: p.display().to_string(),
            arc: true,
        });
    }
    Listing { path: base.display().to_string(), crumbs: crumbs(root, &base), entries }
}

/// Same numbers as `stats`, for a folder inside a zip (sizes are uncompressed).
fn archive_stats(z: &Path, inner: &str, files: &[(String, u64)]) -> Stats {
    let pre = if inner.is_empty() { String::new() } else { format!("{inner}/") };
    let base = under(z, inner);
    let mut st = Stats::default();
    let mut dirs = std::collections::HashSet::new();
    for (name, size) in files {
        let Some(rest) = name.strip_prefix(&pre) else { continue };
        let p = under(&base, rest);
        st.bytes += size;
        st.files += 1;
        rest.match_indices('/').for_each(|(i, _)| {
            dirs.insert(&rest[..i]);
        });
        if let Some((top, _)) = rest.split_once('/') {
            *st.children.entry(base.join(top).display().to_string()).or_default() += size;
        }
        let b = st.by_type.entry(category(&p)).or_default();
        b.bytes += size;
        b.count += 1;
        st.largest.push((p.file_name().unwrap_or_default().to_string_lossy().into_owned(), p.display().to_string(), *size));
    }
    st.dirs = dirs.len() as u64;
    st.largest.sort_by(|a, b| b.2.cmp(&a.2));
    st.largest.truncate(10);
    st
}

/// Run `f` on the reader + uncompressed size of the file `inner` inside zip `z`.
fn with_entry<T>(z: &Path, inner: &str, f: impl FnOnce(&mut dyn std::io::Read, u64) -> Result<T, String>) -> Result<T, String> {
    let mut a = open_zip(z)?;
    let i = (0..a.len()).find(|&i| a.by_index_raw(i).map(|e| zip_name(e.name()) == inner).unwrap_or(false)).ok_or("not found in the zip")?;
    let mut e = a.by_index(i).map_err(|e| e.to_string())?;
    let size = e.size();
    f(&mut e, size)
}

// ponytail: whole entry in memory, no Range requests (video seeking may not work); stream if big clips matter
const MAX_IN_APP: u64 = 512 << 20;

/// Bytes of one file inside a zip, for showing it in the app.
fn read_entry(z: &Path, inner: &str) -> Result<Vec<u8>, String> {
    with_entry(z, inner, |r, size| {
        if size > MAX_IN_APP {
            return Err("too big to show in the app".into());
        }
        let mut buf = Vec::with_capacity(size as usize);
        std::io::Read::read_to_end(r, &mut buf).map_err(|e| e.to_string())?;
        Ok(buf)
    })
}

/// Copy one file out of a zip into `dir` (keeping its folders; ".." parts dropped), for opening
/// with the computer's default program.
fn extract_entry(z: &Path, inner: &str, dir: &Path) -> Result<PathBuf, String> {
    let safe = inner.split('/').filter(|s| !s.is_empty() && *s != "." && *s != "..").collect::<Vec<_>>().join("/");
    let out = under(&dir.join(z.file_stem().unwrap_or_default()), &safe);
    with_entry(z, inner, |r, _| {
        fs::create_dir_all(out.parent().unwrap_or(dir)).map_err(|e| e.to_string())?;
        std::io::copy(r, &mut fs::File::create(&out).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        Ok(out.clone())
    })
}

const MAX_TEXT: usize = 8 << 20;

/// First 8 MB of a text file (on the drive or inside a zip) as raw bytes; the page picks the encoding.
fn text_bytes(p: &Path) -> Result<Vec<u8>, String> {
    let mut b = match split_archive(p) {
        Some((z, inner)) if !inner.is_empty() => read_entry(&z, &inner)?,
        _ => {
            let mut b = vec![];
            std::io::Read::read_to_end(&mut std::io::Read::take(fs::File::open(p).map_err(|e| e.to_string())?, MAX_TEXT as u64), &mut b).map_err(|e| e.to_string())?;
            b
        }
    };
    b.truncate(MAX_TEXT);
    Ok(b)
}

#[tauri::command]
async fn read_text(path: String, d: State<'_, Drive>) -> Result<tauri::ipc::Response, String> {
    let p = PathBuf::from(&path);
    if !inside(&d, &p) || p.is_dir() {
        return Err("not allowed".into());
    }
    tauri::async_runtime::spawn_blocking(move || text_bytes(&p).map(tauri::ipc::Response::new)).await.map_err(|e| e.to_string())?
}

fn mime(p: &Path) -> &'static str {
    match ext_of(p).as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "m4a" => "audio/mp4",
        "aac" => "audio/aac",
        "wav" => "audio/wav",
        "ogg" | "oga" | "opus" => "audio/ogg",
        "flac" => "audio/flac",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "ogv" => "video/ogg",
        _ => "application/octet-stream", // text is decoded by the page itself (UTF-8 or Thai Windows-874)
    }
}

/// %XX-decode a URL path (the page builds it with encodeURIComponent).
fn pct_decode(s: &str) -> String {
    let hex = |c: u8| (c as char).to_digit(16).map(|v| v as u8);
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if let (b'%', Some(Some(h)), Some(Some(l))) = (b[i], b.get(i + 1).map(|&c| hex(c)), b.get(i + 2).map(|&c| hex(c))) {
            out.push(h * 16 + l);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// arc://localhost/<path inside a zip>: that file's bytes, so <img>/<audio>/<video>/fetch can use it.
fn arc_response(d: &Drive, url_path: &str) -> tauri::http::Response<Vec<u8>> {
    let p = PathBuf::from(pct_decode(url_path.trim_start_matches('/')));
    let r = if !inside(d, &p) { Err("not allowed".to_string()) } else { split_archive(&p).ok_or("not in a zip".to_string()).and_then(|(z, inner)| read_entry(&z, &inner)) };
    let b = tauri::http::Response::builder().header("Access-Control-Allow-Origin", "*");
    match r {
        Ok(bytes) => b.header("Content-Type", mime(&p)).body(bytes),
        Err(e) => b.status(404).body(e.into_bytes()),
    }
    .unwrap()
}

#[derive(Serialize, Default)]
struct Bucket {
    bytes: u64,
    count: u64,
}

#[derive(Serialize, Default)]
struct Stats {
    bytes: u64,
    files: u64,
    dirs: u64,
    by_type: BTreeMap<&'static str, Bucket>,
    largest: Vec<(String, String, u64)>, // (name, path, size), biggest first
    children: HashMap<String, u64>,      // size of each direct subfolder, by path
    disk: Option<(u64, u64)>,            // (total, free) bytes of the drive
}

/// Walk everything under `dir` once: totals, sizes per type and per direct subfolder, largest files.
/// Links are not followed, so loops are impossible.
fn stats(dir: &Path) -> Stats {
    let mut st = Stats::default();
    let mut stack = vec![(dir.to_path_buf(), None::<String>)];
    while let Some((d, top)) = stack.pop() {
        let Ok(rd) = fs::read_dir(&d) else { continue };
        for e in rd.flatten() {
            let Ok(md) = e.metadata() else { continue }; // DirEntry::metadata does not follow links
            let p = e.path();
            if md.is_dir() {
                st.dirs += 1;
                let key = top.clone().unwrap_or_else(|| p.display().to_string());
                st.children.entry(key.clone()).or_default();
                stack.push((p, Some(key)));
            } else if md.is_file() {
                let size = md.len();
                st.bytes += size;
                st.files += 1;
                if let Some(k) = &top {
                    *st.children.entry(k.clone()).or_default() += size;
                }
                let b = st.by_type.entry(category(&p)).or_default();
                b.bytes += size;
                b.count += 1;
                if st.largest.len() < 10 || size > st.largest.last().map_or(0, |l| l.2) {
                    st.largest.push((e.file_name().to_string_lossy().into_owned(), p.display().to_string(), size));
                    st.largest.sort_by(|a, b| b.2.cmp(&a.2));
                    st.largest.truncate(10);
                }
            }
        }
    }
    st
}

#[cfg(windows)]
fn disk_space(p: &Path) -> Option<(u64, u64)> {
    use windows::{core::HSTRING, Win32::Storage::FileSystem::GetDiskFreeSpaceExW};
    let (mut avail, mut total, mut free) = (0u64, 0u64, 0u64);
    unsafe { GetDiskFreeSpaceExW(&HSTRING::from(p.as_os_str()), Some(&mut avail), Some(&mut total), Some(&mut free)) }.ok()?;
    Some((total, avail))
}

#[cfg(not(windows))]
fn disk_space(_p: &Path) -> Option<(u64, u64)> {
    None // ponytail: Windows only; add statvfs if the Linux/macOS build needs it
}

#[tauri::command]
async fn dir_stats(path: String, d: State<'_, Drive>) -> Result<Stats, String> {
    let p = PathBuf::from(&path);
    if !inside(&d, &p) {
        return Err("not allowed".into());
    }
    let root = d.root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut st = match split_archive(&p) {
            Some((z, inner)) => zip_files(&z).map(|f| archive_stats(&z, &inner, &f)).unwrap_or_default(),
            None => stats(&p),
        };
        st.disk = disk_space(&root);
        st
    })
    .await
    .map_err(|e| e.to_string())
}

#[derive(Serialize)]
struct Moved {
    from: String,
    path: String,
    rel: String,
}

#[derive(Serialize, Default)]
struct MoveResult {
    moved: Vec<Moved>,
    failed: Vec<String>, // "name: reason"
}

/// `name` in `dir`, or "name (2).ext", "name (3).ext"... if taken: a move never overwrites.
fn free_path(dir: &Path, name: &std::ffi::OsStr) -> PathBuf {
    let p = dir.join(name);
    if !p.exists() {
        return p;
    }
    let n = Path::new(name);
    let stem = n.file_stem().unwrap_or(name).to_string_lossy();
    let ext = n.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..).map(|i| dir.join(format!("{stem} ({i}){ext}"))).find(|p| !p.exists()).unwrap()
}

/// Move files into folder `dest`, both inside the drive. Each file succeeds or fails on its own.
fn move_into(root: &Path, paths: &[String], dest: &Path) -> MoveResult {
    let mut r = MoveResult::default();
    for f in paths {
        let src = PathBuf::from(f);
        let name = src.file_name().unwrap_or_default().to_owned();
        if src.parent() == Some(dest) {
            continue; // already there
        }
        let to = free_path(dest, &name);
        // ponytail: rename only (same drive); add copy+delete if moving across drives is ever needed
        match fs::rename(&src, &to) {
            Ok(()) => r.moved.push(Moved { from: f.clone(), rel: rel_of(root, &to), path: to.display().to_string() }),
            Err(e) => r.failed.push(format!("{}: {e}", name.to_string_lossy())),
        }
    }
    r
}

#[tauri::command]
async fn move_files(paths: Vec<String>, dest: String, d: State<'_, Drive>) -> Result<MoveResult, String> {
    let dest = PathBuf::from(&dest);
    if !dest.is_dir() || !inside(&d, &dest) || paths.iter().any(|p| !Path::new(p).is_file() || !inside(&d, Path::new(p))) {
        return Err("not allowed".into());
    }
    let root = d.root.clone();
    tauri::async_runtime::spawn_blocking(move || move_into(&root, &paths, &dest)).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn get_settings(d: State<Drive>) -> String {
    fs::read_to_string(&d.settings_file).unwrap_or_else(|_| "{}".into())
}

#[tauri::command]
fn set_settings(json: String, d: State<Drive>) -> Result<(), String> {
    if json.len() > 1_000_000 || serde_json::from_str::<serde_json::Value>(&json).is_err() {
        return Err("invalid settings".into());
    }
    fs::write(&d.settings_file, json).map_err(|e| e.to_string())
}

/// --root=<dir> override; release: the drive the exe runs from; debug: current folder.
fn root_dir() -> PathBuf {
    if let Some(r) = std::env::args().find_map(|a| a.strip_prefix("--root=").map(PathBuf::from)) {
        return std::path::absolute(&r).unwrap_or(r);
    }
    if cfg!(debug_assertions) {
        return std::env::current_dir().unwrap();
    }
    let exe = std::env::current_exe().unwrap();
    exe.ancestors().last().unwrap_or(&exe).to_path_buf()
}

fn main() {
    let root = root_dir();
    // settings live next to the exe, so they travel with the flash drive
    let settings_file = std::env::current_exe()
        .ok()
        .and_then(|e| e.parent().map(|p| p.join(".flashdrivehome.json")))
        .unwrap_or_else(|| root.join(".flashdrivehome.json"));
    let scope_root = root.clone();
    tauri::Builder::default()
        .manage(Drive { root_canon: fs::canonicalize(&root).unwrap_or_else(|_| root.clone()), root, settings_file, normal: Mutex::new(None) })
        .register_asynchronous_uri_scheme_protocol("arc", |ctx, req, responder| {
            let app = ctx.app_handle().clone();
            let path = req.uri().path().to_string();
            std::thread::spawn(move || responder.respond(arc_response(&app.state::<Drive>(), &path)));
        })
        .setup(move |app| {
            app.asset_protocol_scope().allow_directory(&scope_root, true)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![info, apps, images, music, videos, open, icons, set_mini, mini_peek, list_dir, dir_stats, move_files, read_text, get_settings, set_settings])
        .run(tauri::generate_context!())
        .expect("error while running app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scans_apps_images_music() {
        let d = std::env::temp_dir().join(format!("fd-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        for f in [
            "Game.exe", "Tools/Paint/Paint.exe", "Tools/Paint/unins000.exe", "Deep/a/b/Too.exe",
            "Pics/a.JPG", "Pics/trip/b.png", "Music/Rock/song.MP3", "Music/x.flac", "Clips/trip.MP4", "notes.txt",
            "node_modules/x.exe", ".hidden/y.png", "Pics/._a.JPG", "._Game.exe",
        ] {
            let p = d.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, "").unwrap();
        }
        fs::create_dir_all(d.join("Calc.app")).unwrap();
        let rel = |exts, depth| {
            let mut v = vec![];
            scan(&d, exts, depth, 100, &mut v);
            v.iter().map(|p| p.strip_prefix(&d).unwrap().to_string_lossy().replace('\\', "/")).collect::<Vec<_>>()
        };
        assert_eq!(rel(APP_EXT, 2), ["Calc.app", "Game.exe", "Tools/Paint/Paint.exe"]);
        assert_eq!(rel(IMG_EXT, 6), ["Pics/a.JPG", "Pics/trip/b.png"]);
        assert_eq!(rel(AUDIO_EXT, 6), ["Music/Rock/song.MP3", "Music/x.flac"]);
        assert_eq!(rel(VIDEO_EXT, 6), ["Clips/trip.MP4"]);

        let m = media(&d, AUDIO_EXT, 6);
        assert_eq!((m[0].album.as_str(), m[0].rel.as_str()), ("Rock", "Music/Rock/song.MP3"));
        assert_eq!(m[1].album, "Music");

        let mut one = vec![];
        scan(&d, IMG_EXT, 6, 1, &mut one);
        assert_eq!(one.len(), 1);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn folder_stats_and_listing() {
        let d = std::env::temp_dir().join(format!("fd-stats-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        let put = |f: &str, n: usize| {
            let p = d.join(f);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, vec![0u8; n]).unwrap();
        };
        put("a.mp3", 300);
        put("Pics/x.png", 1000);
        put("Pics/old/y.jpg", 50);
        put("Docs/r.pdf", 20);
        put("Docs/z.unknown", 5);
        fs::create_dir_all(d.join("Empty")).unwrap();

        let st = stats(&d);
        assert_eq!((st.bytes, st.files, st.dirs), (1375, 5, 4));
        assert_eq!(st.children[&d.join("Pics").display().to_string()], 1050);
        assert_eq!(st.children[&d.join("Docs").display().to_string()], 25);
        assert_eq!(st.children[&d.join("Empty").display().to_string()], 0);
        assert_eq!((st.by_type["image"].bytes, st.by_type["image"].count), (1050, 2));
        assert_eq!((st.by_type["document"].bytes, st.by_type["other"].bytes, st.by_type["audio"].bytes), (20, 5, 300));
        assert_eq!(st.largest.iter().map(|l| l.0.as_str()).collect::<Vec<_>>(), ["x.png", "a.mp3", "y.jpg", "r.pdf", "z.unknown"]);

        let l = list(&d, &d.join("Pics/old")).unwrap();
        assert_eq!(l.crumbs.iter().map(|c| c.0.as_str()).collect::<Vec<_>>()[1..], ["Pics", "old"]);
        assert_eq!((l.entries.len(), l.entries[0].kind, l.entries[0].size, l.entries[0].rel.as_str()), (1, "image", 50, "Pics/old/y.jpg"));

        // inside(): only paths under the drive root
        let drive = Drive { root: d.clone(), root_canon: fs::canonicalize(&d).unwrap(), settings_file: d.join("s"), normal: Mutex::new(None) };
        assert!(inside(&drive, &d.join("Pics/x.png")));
        assert!(inside(&drive, &d));
        assert!(!inside(&drive, &d.join("Pics/../..")));
        assert!(!inside(&drive, &std::env::temp_dir()));
        assert!(!inside(&drive, &d.join("missing.txt")));
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn move_never_overwrites() {
        let d = std::env::temp_dir().join(format!("fd-move-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(d.join("A")).unwrap();
        fs::create_dir_all(d.join("B")).unwrap();
        for (f, s) in [("A/x.jpg", "new"), ("A/y.png", "y"), ("B/x.jpg", "old"), ("B/x (2).jpg", "old2")] {
            fs::write(d.join(f), s).unwrap();
        }
        let s = |f: &str| d.join(f).display().to_string();
        let r = move_into(&d, &[s("A/x.jpg"), s("A/y.png"), s("A/gone.jpg"), s("B/x.jpg")], &d.join("B"));
        assert_eq!(r.moved.iter().map(|m| m.rel.as_str()).collect::<Vec<_>>(), ["B/x (3).jpg", "B/y.png"]);
        assert_eq!(r.failed.len(), 1); // gone.jpg; B/x.jpg was already there and is left alone
        assert_eq!(fs::read_to_string(d.join("B/x.jpg")).unwrap(), "old");
        assert_eq!(fs::read_to_string(d.join("B/x (3).jpg")).unwrap(), "new");
        assert!(!d.join("A/x.jpg").exists());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn zip_as_folder() {
        use std::io::Write;
        let d = std::env::temp_dir().join(format!("fd-zip-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        let z = d.join("pack.zip");
        let mut w = zip::ZipWriter::new(fs::File::create(&z).unwrap());
        for (name, body) in [("top.txt", "hi"), ("pics/a.png", "png!"), ("pics/old/b.jpg", "jpg"), ("win\\c.mp3", "mp3"), ("../evil.txt", "x")] {
            w.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(body.as_bytes()).unwrap();
        }
        w.finish().unwrap();

        assert_eq!(split_archive(&z), Some((z.clone(), String::new())));
        assert_eq!(split_archive(&z.join("pics").join("a.png")), Some((z.clone(), "pics/a.png".into())));
        assert_eq!(split_archive(&d.join("top.txt")), None);
        let drive = Drive { root: d.clone(), root_canon: fs::canonicalize(&d).unwrap(), settings_file: d.join("s"), normal: Mutex::new(None) };
        assert!(inside(&drive, &z.join("pics").join("a.png")));

        let files = zip_files(&z).unwrap();
        let l = list_archive(&d, &z, "", &files);
        let mut names: Vec<_> = l.entries.iter().map(|e| (e.name.as_str(), e.dir, e.kind)).collect();
        names.sort();
        assert_eq!(names, [("pics", true, "folder"), ("top.txt", false, "document"), ("win", true, "folder")]); // no "..": evil.txt hidden
        assert_eq!(l.crumbs.iter().map(|c| c.0.as_str()).collect::<Vec<_>>()[1..], ["pack.zip"]);
        let l = list_archive(&d, &z, "pics", &files);
        assert_eq!(l.entries.len(), 2);
        assert!(l.entries.iter().all(|e| e.arc));
        assert_eq!(l.crumbs.last().unwrap().0, "pics");

        let st = archive_stats(&z, "", &files);
        assert_eq!((st.files, st.bytes, st.dirs), (4, 2 + 4 + 3 + 3, 3)); // pics, pics/old, win
        assert_eq!(st.children[&z.join("pics").display().to_string()], 7);
        assert_eq!(st.largest[0].0, "a.png");

        assert_eq!(read_entry(&z, "pics/old/b.jpg").unwrap(), b"jpg");
        assert_eq!(read_entry(&z, "win/c.mp3").unwrap(), b"mp3"); // '\' name found by its '/' form
        assert!(read_entry(&z, "missing.txt").is_err());
        let out = extract_entry(&z, "../evil.txt", &d.join("tmp")).unwrap();
        assert!(out.starts_with(d.join("tmp").join("pack")), "zip-slip: {out:?}");
        assert_eq!(fs::read_to_string(out).unwrap(), "x");

        let enc = |s: &str| s.bytes().map(|b| format!("%{b:02X}")).collect::<String>();
        let r = arc_response(&drive, &format!("/{}", enc(&z.join("pics").join("a.png").display().to_string())));
        assert_eq!((r.status().as_u16(), r.headers()["Content-Type"].to_str().unwrap(), r.body().as_slice()), (200, "image/png", &b"png!"[..]));
        assert_eq!(arc_response(&drive, &format!("/{}", enc(&std::env::temp_dir().join("x.zip").join("a").display().to_string()))).status().as_u16(), 404);
        assert_eq!(pct_decode("D%3A%5C%E0%B8%81%zz.txt"), "D:\\ก%zz.txt");
        assert_eq!(text_bytes(&z.join("top.txt")).unwrap(), b"hi");
        fs::write(d.join("plain.txt"), "plain").unwrap();
        assert_eq!(text_bytes(&d.join("plain.txt")).unwrap(), b"plain");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn overlay_positions() {
        let wa = (0, 0, 1920, 1040); // 1080p minus a 40px taskbar
        assert_eq!(anchor_xy(wa, 400, 112, 12, "br"), (1508, 916));
        assert_eq!(anchor_xy(wa, 400, 112, 12, "tl"), (12, 12));
        assert_eq!(anchor_xy(wa, 400, 112, 12, "tr"), (1508, 12));
        assert_eq!(anchor_xy(wa, 400, 112, 12, "bl"), (12, 916));
        assert_eq!(anchor_xy(wa, 400, 112, 12, "r"), (1508, 464));
        assert_eq!(anchor_xy(wa, 400, 112, 12, "l"), (12, 464));
        // second monitor to the left, taskbar on top
        assert_eq!(anchor_xy((-1280, 30, 1280, 994), 400, 112, 12, "br"), (-412, 900));
        // tucked: only the 14px strip stays on screen
        assert_eq!(peek_x(wa, 400, 12, 14, "br", true), 1906);
        assert_eq!(peek_x(wa, 400, 12, 14, "r", false), 1508);
        assert_eq!(peek_x(wa, 400, 12, 14, "tl", true), -386);
        assert_eq!(peek_x(wa, 400, 12, 14, "l", false), 12);
    }
}
