//! Canonical types shared by all capture transports and presentation surfaces.

mod capture_message;
mod exchange_summary;
mod http_exchange;
mod validation;

pub use capture_message::{
    CaptureMessage, CaptureUiDelta, ClientHello, HelloAccepted, HelloError, ProtocolRange,
    ServerMessage,
};
pub use exchange_summary::HttpExchangeSummary;
pub use http_exchange::{
    AddressDetails, BodyAvailability, BodyContent, ByteCount, CaptureFidelity,
    CaptureProvenance, CaptureSource, CorrelationContext, DurationValue, ExchangeFailure,
    ExchangeFailureCategory, ExchangeKey, ExchangeLifecycle, ExchangeSizes, ExchangeState,
    ExchangeTiming, HeaderEntry, HttpBody, HttpExchange, HttpRequest,
    HttpResponse, Metadata, QueryEntry, SchemaVersion,
};
pub use validation::{ModelValidationError, ValidationLimits};
