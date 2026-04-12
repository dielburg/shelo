use serde::{Deserialize, Serialize};
use std::fmt;
use std::fs;
use std::path::PathBuf;
use zeroize::Zeroizing;

use super::crypto;

#[derive(Serialize, Deserialize, Clone)]
pub struct HostEntry {
    pub id: u32,
    pub label: String,
    pub hostname: String,
    pub port: u16,
    pub username: String,
    pub group: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub jump_path: Option<Vec<u32>>,
}

impl fmt::Debug for HostEntry {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("HostEntry")
            .field("id", &self.id)
            .field("label", &self.label)
            .field("hostname", &self.hostname)
            .field("port", &self.port)
            .field("username", &self.username)
            .field("group", &self.group)
            .field("password", &self.password.as_ref().map(|_| "<redacted>"))
            .field("jump_path", &self.jump_path)
            .finish()
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TunnelEntry {
    pub id: u32,
    pub label: String,
    pub host_id: u32,
    pub tunnel_type: String,
    pub bind_address: String,
    pub source_port: u16,
    pub destination_host: String,
    pub destination_port: u16,
}

#[derive(Serialize, Deserialize, Default)]
pub struct HostsFile {
    pub next_id: u32,
    pub hosts: Vec<HostEntry>,
    #[serde(default)]
    pub next_tunnel_id: u32,
    #[serde(default)]
    pub tunnels: Vec<TunnelEntry>,
}

pub struct PlaintextStore {
    path: PathBuf,
}

impl PlaintextStore {
    pub fn new(data_dir: &PathBuf) -> Result<Self, String> {
        fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
        Ok(Self {
            path: data_dir.join("hosts.json"),
        })
    }

    pub fn exists(data_dir: &PathBuf) -> bool {
        data_dir.join("hosts.json").exists()
    }

    fn read_file(&self) -> HostsFile {
        match fs::read_to_string(&self.path) {
            Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
            Err(_) => HostsFile::default(),
        }
    }

    fn write_file(&self, file: &HostsFile) -> Result<(), String> {
        let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
        fs::write(&self.path, json).map_err(|e| e.to_string())
    }
}

pub struct EncryptedStore {
    path: PathBuf,
    key: Zeroizing<[u8; crypto::KEY_LEN]>,
    salt: [u8; 16],
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
}

impl EncryptedStore {
    pub fn new(data_dir: &PathBuf, password: String) -> Result<Self, String> {
        fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
        let path = data_dir.join("hosts.vault");

        let vault_data = fs::read(&path).map_err(|e| format!("Failed to read vault: {}", e))?;

        let key = crypto::derive_key_from_vault(&vault_data, &password)?;
        let salt = crypto::read_salt(&vault_data)?;
        let (m_cost, t_cost, p_cost) = crypto::read_argon2_params(&vault_data)?;

        crypto::decrypt_with_key(&vault_data, &key)?;

        Ok(Self {
            path,
            key,
            salt,
            m_cost,
            t_cost,
            p_cost,
        })
    }

    pub fn create(data_dir: &PathBuf, password: String) -> Result<Self, String> {
        fs::create_dir_all(data_dir).map_err(|e| e.to_string())?;
        let path = data_dir.join("hosts.vault");

        let mut salt = [0u8; 16];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut salt);

        let m_cost = 65536u32;
        let t_cost = 3u32;
        let p_cost = 4u32;

        let key = crypto::derive_key(password.as_bytes(), &salt, m_cost, t_cost, p_cost)?;

        let store = Self {
            path,
            key,
            salt,
            m_cost,
            t_cost,
            p_cost,
        };

        store.write_file(&HostsFile::default())?;

        #[cfg(unix)]
        Self::set_file_permissions(&store.path)?;

        Ok(store)
    }

    pub fn exists(data_dir: &PathBuf) -> bool {
        data_dir.join("hosts.vault").exists()
    }

    fn read_file(&self) -> HostsFile {
        match fs::read(&self.path) {
            Ok(vault_data) => match crypto::decrypt_with_key(&vault_data, &self.key) {
                Ok(plaintext) => serde_json::from_slice(&plaintext).unwrap_or_default(),
                Err(_) => HostsFile::default(),
            },
            Err(_) => HostsFile::default(),
        }
    }

    fn write_file(&self, file: &HostsFile) -> Result<(), String> {
        let json = serde_json::to_string_pretty(file).map_err(|e| e.to_string())?;
        let vault_data = crypto::encrypt_with_key(
            json.as_bytes(),
            &self.key,
            &self.salt,
            self.m_cost,
            self.t_cost,
            self.p_cost,
        )?;
        fs::write(&self.path, vault_data).map_err(|e| format!("Failed to write vault: {}", e))?;

        #[cfg(unix)]
        Self::set_file_permissions(&self.path)?;

        Ok(())
    }

    pub fn change_password(&mut self, new_password: String) -> Result<(), String> {
        let file = self.read_file();

        let mut new_salt = [0u8; 16];
        rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut new_salt);

        let new_key = crypto::derive_key(
            new_password.as_bytes(),
            &new_salt,
            self.m_cost,
            self.t_cost,
            self.p_cost,
        )?;

        self.key = new_key;
        self.salt = new_salt;
        self.write_file(&file)
    }

    #[cfg(unix)]
    fn set_file_permissions(path: &PathBuf) -> Result<(), String> {
        use std::os::unix::fs::PermissionsExt;
        let perms = std::fs::Permissions::from_mode(0o600);
        fs::set_permissions(path, perms)
            .map_err(|e| format!("Failed to set vault permissions: {}", e))
    }
}

pub enum HostStore {
    Plaintext(PlaintextStore),
    Encrypted(EncryptedStore),
}

impl HostStore {
    fn read_file(&self) -> HostsFile {
        match self {
            HostStore::Plaintext(s) => s.read_file(),
            HostStore::Encrypted(s) => s.read_file(),
        }
    }

    fn write_file(&self, file: &HostsFile) -> Result<(), String> {
        match self {
            HostStore::Plaintext(s) => s.write_file(file),
            HostStore::Encrypted(s) => s.write_file(file),
        }
    }

    pub fn read_hosts_file(&self) -> HostsFile {
        self.read_file()
    }

    pub fn list(&self) -> Result<Vec<HostEntry>, String> {
        Ok(self.read_file().hosts)
    }

    pub fn add(&self, mut entry: HostEntry) -> Result<HostEntry, String> {
        let mut file = self.read_file();
        file.next_id = file
            .next_id
            .max(entry.id)
            .max(file.hosts.iter().map(|h| h.id).max().unwrap_or(0))
            + 1;
        entry.id = file.next_id;
        file.hosts.push(entry.clone());
        self.write_file(&file)?;
        Ok(entry)
    }

    pub fn update(&self, entry: HostEntry) -> Result<(), String> {
        let mut file = self.read_file();
        if let Some(existing) = file.hosts.iter_mut().find(|h| h.id == entry.id) {
            *existing = entry;
            self.write_file(&file)
        } else {
            Err(format!("host {} not found", entry.id))
        }
    }

    pub fn delete(&self, id: u32) -> Result<(), String> {
        let mut file = self.read_file();
        let before = file.hosts.len();
        file.hosts.retain(|h| h.id != id);
        if file.hosts.len() == before {
            return Err(format!("host {} not found", id));
        }
        self.write_file(&file)
    }

    pub fn list_tunnels(&self) -> Result<Vec<TunnelEntry>, String> {
        Ok(self.read_file().tunnels)
    }

    pub fn add_tunnel(&self, mut entry: TunnelEntry) -> Result<TunnelEntry, String> {
        let mut file = self.read_file();
        file.next_tunnel_id = file
            .next_tunnel_id
            .max(entry.id)
            .max(file.tunnels.iter().map(|t| t.id).max().unwrap_or(0))
            + 1;
        entry.id = file.next_tunnel_id;
        file.tunnels.push(entry.clone());
        self.write_file(&file)?;
        Ok(entry)
    }

    pub fn update_tunnel(&self, entry: TunnelEntry) -> Result<(), String> {
        let mut file = self.read_file();
        if let Some(existing) = file.tunnels.iter_mut().find(|t| t.id == entry.id) {
            *existing = entry;
            self.write_file(&file)
        } else {
            Err(format!("tunnel {} not found", entry.id))
        }
    }

    pub fn delete_tunnel(&self, id: u32) -> Result<(), String> {
        let mut file = self.read_file();
        let before = file.tunnels.len();
        file.tunnels.retain(|t| t.id != id);
        if file.tunnels.len() == before {
            return Err(format!("tunnel {} not found", id));
        }
        self.write_file(&file)
    }

    pub fn change_password(&mut self, new_password: String) -> Result<(), String> {
        match self {
            HostStore::Encrypted(s) => s.change_password(new_password),
            HostStore::Plaintext(_) => Err("Cannot change password on plaintext store".to_string()),
        }
    }
}
