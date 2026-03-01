use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone)]
struct KnownHostEntry {
    hostname: String,
    port: u16,
    fingerprint: String,
}

#[derive(Serialize, Deserialize, Default)]
struct KnownHostsFile {
    hosts: Vec<KnownHostEntry>,
}

pub enum HostKeyStatus {
    Known,
    Unknown,
    Changed { expected: String },
}

pub struct KnownHostsStore {
    path: PathBuf,
}

impl KnownHostsStore {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            path: data_dir.join("known_hosts.json"),
        }
    }

    fn read_file(&self) -> KnownHostsFile {
        match fs::read_to_string(&self.path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => KnownHostsFile::default(),
        }
    }

    fn write_file(&self, file: &KnownHostsFile) -> Result<(), String> {
        let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
        fs::write(&self.path, json).map_err(|e| e.to_string())
    }

    pub fn check(&self, hostname: &str, port: u16, fingerprint: &str) -> HostKeyStatus {
        let file = self.read_file();

        match file.hosts.iter().find(|h| h.hostname == hostname && h.port == port) {
            Some(entry) if entry.fingerprint == fingerprint => HostKeyStatus::Known,
            Some(entry) => HostKeyStatus::Changed {
                expected: entry.fingerprint.clone(),
            },
            None => HostKeyStatus::Unknown,
        }
    }

    pub fn add(&self, hostname: &str, port: u16, fingerprint: &str) -> Result<(), String> {
        let mut file = self.read_file();
        file.hosts.push(KnownHostEntry {
            hostname: hostname.to_string(),
            port,
            fingerprint: fingerprint.to_string(),
        });
        self.write_file(&file)
    }

    pub fn remove(&self, hostname: &str, port: u16) {
        let mut file = self.read_file();
        file.hosts.retain(|h| !(h.hostname == hostname && h.port == port));
        let _ = self.write_file(&file);
    }
}
