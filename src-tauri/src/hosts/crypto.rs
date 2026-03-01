use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use rand::RngCore;
use zeroize::Zeroizing;

const VAULT_MAGIC: &[u8; 4] = b"SHEV"; // -- Shelo Vault
const VAULT_VERSION: u8 = 0x01; // -- Vault format revision
const CIPHER_AES256GCM: u8 = 0x01;

const SALT_LEN: usize = 16;
const NONCE_LEN: usize = 12;
pub const KEY_LEN: usize = 32;

const HEADER_LEN: usize = 4 + 1 + 1 + SALT_LEN + 4 + 4 + 4 + NONCE_LEN + 4;

const DEFAULT_M_COST: u32 = 65536;
const DEFAULT_T_COST: u32 = 3;
const DEFAULT_P_COST: u32 = 4;

pub fn derive_key(
    password: &[u8],
    salt: &[u8],
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    let params = Params::new(m_cost, t_cost, p_cost, Some(KEY_LEN))
        .map_err(|e| format!("Invalid Argon2 params: {}", e))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut key = Zeroizing::new([0u8; KEY_LEN]);
    argon2
        .hash_password_into(password, salt, key.as_mut())
        .map_err(|e| format!("Key derivation failed: {}", e))?;
    Ok(key)
}

pub fn read_salt(vault_data: &[u8]) -> Result<[u8; SALT_LEN], String> {
    validate_header(vault_data)?;
    let mut salt = [0u8; SALT_LEN];
    salt.copy_from_slice(&vault_data[6..22]);
    Ok(salt)
}

pub fn read_argon2_params(vault_data: &[u8]) -> Result<(u32, u32, u32), String> {
    validate_header(vault_data)?;
    let m_cost = u32::from_le_bytes(vault_data[22..26].try_into().unwrap());
    let t_cost = u32::from_le_bytes(vault_data[26..30].try_into().unwrap());
    let p_cost = u32::from_le_bytes(vault_data[30..34].try_into().unwrap());
    Ok((m_cost, t_cost, p_cost))
}

fn validate_header(vault_data: &[u8]) -> Result<(), String> {
    if vault_data.len() < HEADER_LEN {
        return Err("Vault file too short".to_string());
    }
    if &vault_data[0..4] != VAULT_MAGIC {
        return Err("Not a valid Shelo vault file".to_string());
    }
    let version = vault_data[4];
    if version != VAULT_VERSION {
        return Err(format!(
            "Unsupported vault version {}. Please update Shelo.",
            version
        ));
    }
    let cipher_id = vault_data[5];
    if cipher_id != CIPHER_AES256GCM {
        return Err(format!("Unsupported cipher: 0x{:02x}", cipher_id));
    }
    Ok(())
}

pub fn encrypt_with_key(
    plaintext: &[u8],
    key: &[u8; KEY_LEN],
    salt: &[u8; SALT_LEN],
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<Vec<u8>, String> {
    let mut rng = rand::thread_rng();

    let mut nonce_bytes = [0u8; NONCE_LEN];
    rng.fill_bytes(&mut nonce_bytes);

    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Cipher init failed: {}", e))?;
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, plaintext)
        .map_err(|e| format!("Encryption failed: {}", e))?;

    let ct_len = ciphertext.len() as u32;

    let mut vault = Vec::with_capacity(HEADER_LEN + ciphertext.len());
    vault.extend_from_slice(VAULT_MAGIC);
    vault.push(VAULT_VERSION);
    vault.push(CIPHER_AES256GCM);
    vault.extend_from_slice(salt);
    vault.extend_from_slice(&m_cost.to_le_bytes());
    vault.extend_from_slice(&t_cost.to_le_bytes());
    vault.extend_from_slice(&p_cost.to_le_bytes());
    vault.extend_from_slice(&nonce_bytes);
    vault.extend_from_slice(&ct_len.to_le_bytes());
    vault.extend_from_slice(&ciphertext);

    Ok(vault)
}

pub fn decrypt_with_key(vault_data: &[u8], key: &[u8; KEY_LEN]) -> Result<Zeroizing<Vec<u8>>, String> {
    validate_header(vault_data)?;

    let nonce_bytes = &vault_data[34..46];
    let ct_len = u32::from_le_bytes(vault_data[46..50].try_into().unwrap()) as usize;

    if vault_data.len() < HEADER_LEN + ct_len {
        return Err("Vault file is truncated".to_string());
    }

    let ciphertext = &vault_data[HEADER_LEN..HEADER_LEN + ct_len];

    let cipher =
        Aes256Gcm::new_from_slice(key).map_err(|e| format!("Cipher init failed: {}", e))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|_| "Decryption failed: wrong password or corrupted vault".to_string())?;

    Ok(Zeroizing::new(plaintext))
}

pub fn encrypt(plaintext: &[u8], password: &str) -> Result<Vec<u8>, String> {
    let mut rng = rand::thread_rng();
    let mut salt = [0u8; SALT_LEN];
    rng.fill_bytes(&mut salt);

    let key = derive_key(
        password.as_bytes(),
        &salt,
        DEFAULT_M_COST,
        DEFAULT_T_COST,
        DEFAULT_P_COST,
    )?;

    encrypt_with_key(plaintext, &key, &salt, DEFAULT_M_COST, DEFAULT_T_COST, DEFAULT_P_COST)
}

pub fn decrypt(vault_data: &[u8], password: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    validate_header(vault_data)?;

    let salt = &vault_data[6..22];
    let m_cost = u32::from_le_bytes(vault_data[22..26].try_into().unwrap());
    let t_cost = u32::from_le_bytes(vault_data[26..30].try_into().unwrap());
    let p_cost = u32::from_le_bytes(vault_data[30..34].try_into().unwrap());

    let key = derive_key(password.as_bytes(), salt, m_cost, t_cost, p_cost)?;

    decrypt_with_key(vault_data, &key)
}

pub fn derive_key_from_vault(vault_data: &[u8], password: &str) -> Result<Zeroizing<[u8; KEY_LEN]>, String> {
    let salt = read_salt(vault_data)?;
    let (m_cost, t_cost, p_cost) = read_argon2_params(vault_data)?;
    derive_key(password.as_bytes(), &salt, m_cost, t_cost, p_cost)
}