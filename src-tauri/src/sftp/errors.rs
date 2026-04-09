use std::time::Duration;

pub const SFTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
pub const SFTP_OP_TIMEOUT: Duration = Duration::from_secs(15);
pub const SFTP_TRANSFER_TIMEOUT: Duration = Duration::from_secs(30);
pub const SFTP_STAT_TIMEOUT: Duration = Duration::from_secs(10);
pub const SFTP_SESSION_TIMEOUT_SECS: u64 = 15;
pub const CHUNK_SIZE: usize = 262144;

pub fn map_sftp_error(e: russh_sftp::client::error::Error) -> String {
    use russh_sftp::client::error::Error;

    match &e {
        Error::Status(status) => {
            use russh_sftp::protocol::StatusCode;
            match status.status_code {
                StatusCode::NoSuchFile => format!("No such file or directory: {}", status.error_message),
                StatusCode::PermissionDenied => format!("Permission denied: {}", status.error_message),
                StatusCode::Failure => {
                    let msg = status.error_message.to_lowercase();
                    if msg.contains("exist") || msg.contains("duplicate") {
                        format!("Already exists: {}", status.error_message)
                    } else {
                        format!("Operation failed: {}", status.error_message)
                    }
                }
                StatusCode::NoConnection => "No connection to server".to_string(),
                StatusCode::ConnectionLost => "Connection lost".to_string(),
                StatusCode::OpUnsupported => "Operation not supported by server".to_string(),
                StatusCode::BadMessage => format!("Bad message: {}", status.error_message),
                StatusCode::Eof => "End of file".to_string(),
                StatusCode::Ok => "OK".to_string(),
            }
        }
        Error::Timeout => "Operation timed out".to_string(),
        Error::IO(msg) => format!("I/O error: {}", msg),
        Error::Limited(msg) => format!("Server limit exceeded: {}", msg),
        Error::UnexpectedPacket => "Unexpected response from server".to_string(),
        Error::UnexpectedBehavior(msg) => format!("Unexpected error: {}", msg),
    }
}

pub fn map_sftp_error_ctx(e: russh_sftp::client::error::Error, path: &str) -> String {
    use russh_sftp::client::error::Error;

    let name = path.rsplit('/').next().unwrap_or(path);

    match &e {
        Error::Status(status) => {
            use russh_sftp::protocol::StatusCode;
            match status.status_code {
                StatusCode::NoSuchFile => format!("No such file or directory: {}", name),
                StatusCode::PermissionDenied => format!("Permission denied: {}", name),
                StatusCode::Failure => {
                    let msg = status.error_message.to_lowercase();
                    if msg.contains("exist") || msg.contains("duplicate") {
                        format!("Already exists: {}", name)
                    } else if msg.contains("not empty") || msg.contains("directory not empty") {
                        format!("Directory not empty: {}", name)
                    } else if msg.contains("space") || msg.contains("quota") || msg.contains("full") {
                        format!("Disk full or quota exceeded: {}", name)
                    } else {
                        format!("Operation failed on '{}': {}", name, status.error_message)
                    }
                }
                StatusCode::NoConnection => "No connection to server".to_string(),
                StatusCode::ConnectionLost => "Connection lost".to_string(),
                StatusCode::OpUnsupported => format!("Operation not supported: {}", name),
                StatusCode::BadMessage => format!("Bad message: {}", name),
                StatusCode::Eof => "End of file".to_string(),
                StatusCode::Ok => "OK".to_string(),
            }
        }
        Error::Timeout => format!("Operation timed out: {}", name),
        Error::IO(msg) => format!("I/O error on '{}': {}", name, msg),
        Error::Limited(msg) => format!("Server limit exceeded: {}", msg),
        Error::UnexpectedPacket => "Unexpected response from server".to_string(),
        Error::UnexpectedBehavior(msg) => format!("Unexpected error: {}", msg),
    }
}

pub fn map_local_error(e: std::io::Error) -> String {
    use std::io::ErrorKind;

    match e.kind() {
        ErrorKind::NotFound => format!("No such file or directory: {}", e),
        ErrorKind::PermissionDenied => format!("Permission denied: {}", e),
        ErrorKind::AlreadyExists => format!("Already exists: {}", e),
        ErrorKind::InvalidInput => format!("Invalid input: {}", e),
        _ => {
            let msg = e.to_string().to_lowercase();
            if msg.contains("no space") || msg.contains("disk full") || msg.contains("quota") {
                return "Disk full: no space left on device".to_string();
            }
            if msg.contains("name too long") || msg.contains("filename too long") {
                return "File name too long".to_string();
            }
            if msg.contains("directory not empty") || msg.contains("not empty") {
                return "Directory not empty".to_string();
            }
            format!("I/O error: {}", e)
        }
    }
}

pub fn timeout_msg(op: &str) -> String {
    format!("{} timed out — server may be unresponsive", op)
}
