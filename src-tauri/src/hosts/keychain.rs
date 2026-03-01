const SERVICE: &str = "com.shelo.app";
const ACCOUNT: &str = "master-password";

pub fn store_master_password(password: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).map_err(|e| format!("Keychain error: {}", e))?;
    entry
        .set_password(password)
        .map_err(|e| format!("Failed to store in keychain: {}", e))
}

pub fn get_master_password() -> Option<String> {
    let entry = keyring::Entry::new(SERVICE, ACCOUNT).ok()?;
    entry.get_password().ok()
}

pub fn delete_master_password() {
    if let Ok(entry) = keyring::Entry::new(SERVICE, ACCOUNT) {
        let _ = entry.delete_credential();
    }
}
