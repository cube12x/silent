//! Runtime error type shared by the spawn layer and callers.

#[derive(Debug, thiserror::Error)]
pub enum RuntimeError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("unavailable: {0}")]
    Unavailable(String),
    #[error("process exceeded {ms} ms timeout")]
    Timeout { ms: u128 },
    #[error("line exceeded {limit} byte limit")]
    LineTooLarge { limit: usize },
    #[error("invalid request: {0}")]
    InvalidRequest(String),
}

pub type RuntimeResult<T> = Result<T, RuntimeError>;
