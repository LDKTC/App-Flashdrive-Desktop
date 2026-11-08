#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::Serialize;
use std::{
    collections::HashSet,
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
const SKIP_DIR: &[&str] = &["node_modules", "$recycle.bin", "system volume information"];
// ponytail: name heuristic to hide installer/helper exes; tune the list if real apps get hidden
const NOT_APP: &[&str] = &["unins", "setup", "update", "crash", "helper", "install"];

struct Drive {
    root: PathBuf,
    settings_file: PathBuf,
    allowed: Mutex<HashSet<PathBuf>>, // only paths we handed to the page may be opened
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
        if is_dir && !matched {
            if depth > 0 && !name.starts_with('.') && !SKIP_DIR.contains(&name.as_str()) {
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
                rel: p.strip_prefix(root).unwrap_or(&p).to_string_lossy().replace('\\', "/"),
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
    let mut allowed = d.allowed.lock().unwrap();
    Ok(found
        .into_iter()
        .filter(|p| fs::canonicalize(p).ok() != me)
        .map(|p| {
            allowed.insert(p.clone());
            AppItem {
                name: p.file_stem().unwrap_or_default().to_string_lossy().into_owned(),
                path: p.display().to_string(),
            }
        })
        .collect())
}

fn media_cmd(d: &Drive, exts: &[&str]) -> Vec<Media> {
    let list = media(&d.root, exts, 6);
    let mut allowed = d.allowed.lock().unwrap();
    allowed.extend(list.iter().map(|m| PathBuf::from(&m.dir)));
    list
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

/// Launch an app or open a folder in the file manager.
#[tauri::command]
fn open(path: String, d: State<Drive>) -> Result<(), String> {
    let p = PathBuf::from(&path);
    if p != d.root && !d.allowed.lock().unwrap().contains(&p) {
        return Err("not allowed".into());
    }
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
    let ok: Vec<bool> = {
        let allowed = d.allowed.lock().unwrap();
        paths.iter().map(|p| allowed.contains(Path::new(p))).collect()
    };
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

/// Fold the window into an always-on-top mini player at the screen's right edge, or restore it.
/// Same window and page, so playback keeps going.
#[tauri::command]
/// `w`/`h` = overlay size in CSS pixels (bigger for video).
fn set_mini(mini: bool, w: f64, h: f64, window: WebviewWindow, d: State<Drive>) -> Result<(), tauri::Error> {
    let mut normal = d.normal.lock().unwrap();
    if mini {
        if normal.is_none() {
            *normal = Some((window.outer_position()?, window.inner_size()?, window.is_maximized()?));
        }
        window.unmaximize()?;
        window.set_decorations(false)?;
        window.set_always_on_top(true)?;
        if let Some(m) = window.current_monitor()? {
            let (s, wa) = (m.scale_factor(), m.work_area()); // work area = screen minus taskbar
            let (w, h, gap) = ((w.clamp(200.0, 800.0) * s) as u32, (h.clamp(80.0, 700.0) * s) as u32, (12.0 * s) as i32);
            window.set_size(PhysicalSize::new(w, h))?;
            window.set_position(PhysicalPosition::new(
                wa.position.x + wa.size.width as i32 - w as i32 - gap,
                wa.position.y + wa.size.height as i32 - h as i32 - gap,
            ))?;
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
        .manage(Drive { root, settings_file, allowed: Mutex::new(HashSet::new()), normal: Mutex::new(None) })
        .setup(move |app| {
            app.asset_protocol_scope().allow_directory(&scope_root, true)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![info, apps, images, music, videos, open, icons, set_mini, get_settings, set_settings])
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
            "node_modules/x.exe", ".hidden/y.png",
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
}
