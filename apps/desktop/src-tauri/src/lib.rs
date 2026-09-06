#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
    thread::{self, JoinHandle},
};
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_dialog::DialogExt;

static NEXT_TERMINAL_ID: AtomicU64 = AtomicU64::new(1);

type TerminalKiller = Box<dyn FnMut() -> std::io::Result<()> + Send>;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase", tag = "event", content = "data")]
enum NativeTerminalEvent {
    Output(String),
    Exited,
    Eof,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NativeTerminalOpenValue {
    terminal_id: String,
    cwd: String,
    shell: String,
}

struct DesktopTerminal {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    killer: TerminalKiller,
    reader_thread: JoinHandle<()>,
    waiter_thread: JoinHandle<()>,
}

#[derive(Default)]
struct DesktopTerminalState {
    terminals: Mutex<HashMap<String, DesktopTerminal>>,
}

impl Drop for DesktopTerminalState {
    fn drop(&mut self) {
        let Ok(terminals) = self.terminals.get_mut() else {
            return;
        };
        for (_, terminal) in terminals.drain() {
            let _ = close_terminal(terminal);
        }
    }
}

fn terminal_map(
    state: &DesktopTerminalState,
) -> Result<MutexGuard<'_, HashMap<String, DesktopTerminal>>, String> {
    state
        .terminals
        .lock()
        .map_err(|_| "native terminal registry is poisoned".to_string())
}

fn default_cwd_path() -> PathBuf {
    for key in ["USERPROFILE", "HOME"] {
        if let Some(value) = std::env::var_os(key) {
            let path = PathBuf::from(value);
            if path.is_dir() {
                return path;
            }
        }
    }
    std::env::current_dir()
        .ok()
        .filter(|path| path.is_dir())
        .unwrap_or_else(|| PathBuf::from("."))
}

fn resolve_cwd(cwd: Option<String>) -> Result<PathBuf, String> {
    let path = cwd.map(PathBuf::from).unwrap_or_else(default_cwd_path);
    if !path.is_dir() {
        return Err(format!("terminal working directory does not exist: {}", path.display()));
    }
    Ok(path)
}

fn close_terminal(mut terminal: DesktopTerminal) -> Result<(), String> {
    let kill_error = (terminal.killer)().err();
    drop(terminal.writer);
    drop(terminal.master);

    let waiter = terminal
        .waiter_thread
        .join()
        .map_err(|_| "native terminal waiter thread panicked".to_string());
    let reader = terminal
        .reader_thread
        .join()
        .map_err(|_| "native terminal reader thread panicked".to_string());

    waiter?;
    reader?;
    if let Some(error) = kill_error {
        // A shell that already exited can reject the cleanup signal. The waiter
        // has reaped it by this point, so only that expected race is ignored.
        if !matches!(
            error.kind(),
            std::io::ErrorKind::InvalidInput | std::io::ErrorKind::NotFound
        ) {
            return Err(format!("failed to terminate native terminal: {error}"));
        }
    }
    Ok(())
}

fn pick_terminal_cwd(app: &AppHandle) -> Result<Option<String>, String> {
    let dialog = app.dialog().file();
    let selected = dialog.blocking_pick_folder();
    let Some(value) = selected else {
        return Ok(None);
    };
    let path = value
        .into_path()
        .map_err(|error| format!("selected folder is not a local path: {error}"))?;
    Ok(Some(path.to_string_lossy().into_owned()))
}

#[tauri::command]
fn desktop_terminal_default_cwd() -> String {
    default_cwd_path().to_string_lossy().into_owned()
}

#[tauri::command]
async fn desktop_terminal_pick_cwd(app: AppHandle) -> Result<Option<String>, String> {
    pick_terminal_cwd(&app)
}

#[tauri::command]
fn desktop_terminal_open(
    cwd: Option<String>,
    rows: u16,
    cols: u16,
    on_event: Channel<NativeTerminalEvent>,
    state: State<'_, DesktopTerminalState>,
) -> Result<NativeTerminalOpenValue, String> {
    if rows == 0 || cols == 0 {
        return Err("native terminal geometry must be positive".to_string());
    }

    let cwd = resolve_cwd(cwd)?;
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to allocate native terminal: {error}"))?;

    let mut command = CommandBuilder::new_default_prog();
    let shell = command.get_shell();
    command.cwd(&cwd);
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("DSH_SPATIAL_TERMINAL", "1");

    let mut child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to start terminal shell: {error}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to open terminal reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("failed to open terminal writer: {error}"))?;
    let mut child_killer = child.clone_killer();
    let killer: TerminalKiller = Box::new(move || child_killer.kill());

    let output_channel = on_event.clone();
    let reader_thread = thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(size) => {
                    let text = String::from_utf8_lossy(&buffer[..size]).into_owned();
                    if output_channel.send(NativeTerminalEvent::Output(text)).is_err() {
                        return;
                    }
                }
                Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        let _ = output_channel.send(NativeTerminalEvent::Eof);
    });

    let exit_channel = on_event;
    let waiter_thread = thread::spawn(move || {
        let _ = child.wait();
        let _ = exit_channel.send(NativeTerminalEvent::Exited);
    });

    let terminal_id = format!(
        "desktop-{}",
        NEXT_TERMINAL_ID.fetch_add(1, Ordering::Relaxed)
    );
    let value = NativeTerminalOpenValue {
        terminal_id: terminal_id.clone(),
        cwd: cwd.to_string_lossy().into_owned(),
        shell,
    };

    terminal_map(&state)?.insert(
        terminal_id,
        DesktopTerminal {
            master: pair.master,
            writer,
            killer,
            reader_thread,
            waiter_thread,
        },
    );
    Ok(value)
}

#[tauri::command]
fn desktop_terminal_write(
    terminal_id: String,
    data: String,
    state: State<'_, DesktopTerminalState>,
) -> Result<(), String> {
    let mut terminals = terminal_map(&state)?;
    let terminal = terminals
        .get_mut(&terminal_id)
        .ok_or_else(|| format!("native terminal is unavailable: {terminal_id}"))?;
    terminal
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| terminal.writer.flush())
        .map_err(|error| format!("failed to write terminal input: {error}"))
}

#[tauri::command]
fn desktop_terminal_resize(
    terminal_id: String,
    rows: u16,
    cols: u16,
    state: State<'_, DesktopTerminalState>,
) -> Result<(), String> {
    if rows == 0 || cols == 0 {
        return Err("native terminal geometry must be positive".to_string());
    }
    let terminals = terminal_map(&state)?;
    let terminal = terminals
        .get(&terminal_id)
        .ok_or_else(|| format!("native terminal is unavailable: {terminal_id}"))?;
    terminal
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to resize terminal: {error}"))
}

fn remove_terminal(
    terminal_id: &str,
    state: &DesktopTerminalState,
) -> Result<Option<DesktopTerminal>, String> {
    Ok(terminal_map(state)?.remove(terminal_id))
}

#[tauri::command]
fn desktop_terminal_stop(
    terminal_id: String,
    state: State<'_, DesktopTerminalState>,
) -> Result<(), String> {
    let terminal = remove_terminal(&terminal_id, &state)?
        .ok_or_else(|| format!("native terminal is unavailable: {terminal_id}"))?;
    close_terminal(terminal)
}

#[tauri::command]
fn desktop_terminal_close(
    terminal_id: String,
    state: State<'_, DesktopTerminalState>,
) -> Result<bool, String> {
    let Some(terminal) = remove_terminal(&terminal_id, &state)? else {
        return Ok(false);
    };
    close_terminal(terminal)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::mpsc, time::Duration};

    #[test]
    fn native_pty_round_trip_preserves_executed_output() {
        const EXPECTED_MARKER: &str = "DSH_PTY_SMOKE_OUTPUT";

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("native PTY allocation should succeed");

        let mut command = CommandBuilder::new_default_prog();
        command.env("DSH_PTY_SMOKE_VALUE", EXPECTED_MARKER);
        let mut child = pair
            .slave
            .spawn_command(command)
            .expect("default shell should start inside native PTY");
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .expect("native PTY reader should open");
        let mut writer = pair
            .master
            .take_writer()
            .expect("native PTY writer should open");
        let mut killer = child.clone_killer();
        let (sender, receiver) = mpsc::channel();
        let reader_thread = thread::spawn(move || {
            let mut output = Vec::new();
            let result = reader.read_to_end(&mut output).map(|_| output);
            let _ = sender.send(result);
        });

        #[cfg(windows)]
        let smoke_command = b"echo %DSH_PTY_SMOKE_VALUE%\rexit\r";
        #[cfg(not(windows))]
        let smoke_command = b"printf '%s\\n' \"$DSH_PTY_SMOKE_VALUE\"\rexit\r";

        writer
            .write_all(smoke_command)
            .expect("native PTY should accept shell input");
        writer.flush().expect("native PTY input should flush");
        drop(writer);

        let output = match receiver.recv_timeout(Duration::from_secs(20)) {
            Ok(Ok(output)) => output,
            Ok(Err(error)) => {
                let _ = killer.kill();
                let _ = child.wait();
                let _ = reader_thread.join();
                panic!("native PTY output read failed: {error}");
            }
            Err(error) => {
                let _ = killer.kill();
                let _ = child.wait();
                let _ = reader_thread.join();
                panic!("native PTY round trip timed out: {error}");
            }
        };

        child.wait().expect("default shell should exit cleanly");
        reader_thread
            .join()
            .expect("native PTY reader thread should not panic");

        let text = String::from_utf8_lossy(&output);
        assert!(
            text.contains(EXPECTED_MARKER),
            "native PTY round trip lost executed marker; output: {text:?}"
        );
    }
}

/** Start the desktop shell around the built, worker-capable Harness page. */
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(DesktopTerminalState::default())
        .invoke_handler(tauri::generate_handler![
            desktop_terminal_default_cwd,
            desktop_terminal_pick_cwd,
            desktop_terminal_open,
            desktop_terminal_write,
            desktop_terminal_resize,
            desktop_terminal_stop,
            desktop_terminal_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DSH Spatial desktop")
}
