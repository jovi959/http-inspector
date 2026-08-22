# HTTP Inspector .NET adapter test manifest

adapter: `HttpInspector.Adapter` 1.4.1
runtime: .NET 10
httpClient: `IHttpClientFactory` / Refit / direct `HttpClient` / direct RestSharp / WCF (`Microsoft.Extensions.Http` 10.x)
transportProfiles: `[websocket-v1]`
spec: `http_inspector_adapter.spec.md` 1.12.0
tddSpec: `http_inspector_adapter_tdd.spec.md` 1.6.0

| ID | Native evidence | Result |
| --- | --- | --- |
| CFG-001 | `AdapterConfigurationTests.CFG_001_explicit_endpoint_wins_over_environment` | pass |
| CFG-002 | `AdapterConfigurationTests.CFG_002_environment_endpoint_is_used_when_no_explicit_endpoint_exists` | pass |
| CFG-003 | Listener endpoint descriptor is not implemented by the product | pendingProductDependency |
| CFG-004 | `AdapterConfigurationTests.CFG_004_development_fallback_uses_the_v1_loopback_endpoint` | pass |
| CFG-005 | `AdapterConfigurationTests.CFG_005_invalid_endpoint_fails_before_workers_start` | pass |
| CFG-006 | `AdapterConfigurationTests.CFG_006_deferred_or_unknown_transport_profile_is_rejected` | pass |
| CFG-007 | `AdapterConfigurationTests.CFG_007_hello_contains_no_pairing_or_authentication_configuration` | pass |
| HSK-001, HSK-002 | `AdapterLifecycleTests.HSK_001_and_HSK_002_hello_is_first_and_uses_configured_v1_source_values` | pass |
| HSK-003 | `AdapterLifecycleTests.HSK_003_capture_started_returns_without_waiting_for_hello_acceptance` | pass |
| HSK-004 | `AdapterLifecycleTests.HSK_004_stores_negotiated_connection_values` | pass |
| HSK-005 | `AdapterLifecycleTests.HSK_005_non_retryable_hello_error_disables_reconnect_and_reports_protocol_mismatch` | pass |
| HSK-006 | `AdapterLifecycleTests.HSK_006_retryable_hello_failure_uses_bounded_backoff_without_throwing_into_capture` | pass |
| HSK-007 | `AdapterLifecycleTests.HSK_007_one_adapter_uses_one_connection_for_many_exchanges` | pass |
| HSK-008 | `AdapterLifecycleTests.HSK_008_stop_flushes_closes_and_is_idempotent` | pass |
| COR-001 | `AdapterLifecycleTests.COR_001_and_LIF_001_start_and_completion_share_exchange_identity_and_use_distinct_message_ids` | pass |
| COR-002 | `AdapterLifecycleTests.COR_002_identical_requests_complete_in_reverse_order_using_their_local_handles` | pass |
| COR-003 | `AdapterLifecycleTests.COR_003_acknowledgements_resolve_by_message_id_even_when_completed_out_of_order` | pass |
| COR-004 | `ListenerContractTests.COR_004_same_exchange_id_from_two_sources_remains_two_server_records` | pass |
| COR-005, COR-006, COR-007 | `AdapterLifecycleTests.COR_005_COR_006_and_COR_007_emit_at_most_one_terminal_with_the_original_exchange_id` | pass |
| COR-008 | `HttpClientBridgeTests.COR_008_mapper_does_not_add_adapter_state_to_the_native_request` | pass |
| COR-009 | `HttpClientBridgeTests.COR_009_exchange_handle_retains_only_value_state_and_no_native_request_or_response_reference` | pass |
| COR-010 | `RecoveryTests.REC_001_REC_003_and_REC_006_reconnect_with_a_fresh_hello_and_recovery_snapshot_while_retaining_source_and_exchange_identity` | pass |
| LIF-001, LIF-005 | `AdapterLifecycleTests.COR_001_and_LIF_001_start_and_completion_share_exchange_identity_and_use_distinct_message_ids` | pass |
| LIF-002 | `AdapterLifecycleTests.LIF_002_4xx_and_5xx_responses_are_completed_not_failed` | pass |
| LIF-003, LIF-004 | `RecoveryTests.LIF_003_and_LIF_004_failures_and_cancellations_keep_the_start_exchange_identity` | pass |
| LIF-006 | `RecoveryTests.LIF_006_unknown_network_timing_is_null_with_unavailable_provenance` | pass |
| LIF-007, LIF-008 | `RecoveryTests.LIF_007_and_LIF_008_emit_one_logical_exchange_per_callback_and_relate_observable_attempts_by_operation_id` | pass |
| LIF-009 | `RecoveryTests.LIF_009_indefinite_streams_remain_in_flight_until_the_host_stack_reports_a_terminal_state` | pass |
| FID-001, FID-003, FID-004 | `FidelityAndQueueTests.FID_001_FID_003_and_FID_004_preserve_duplicate_headers_ordered_query_and_sensitive_values` | pass |
| FID-002 | `FidelityAndQueueTests.FID_002_preserves_duplicate_response_headers_in_order` | pass |
| FID-005, FID-006 | `FidelityAndQueueTests.FID_005_and_FID_006_preserve_json_and_xml_soap_lexical_text` | pass |
| FID-007 | `FidelityAndQueueTests.FID_007_binary_body_is_encoded_once_as_standard_base64` | pass |
| FID-008, FID-009 | `FidelityAndQueueTests.FID_008_and_FID_009_empty_and_unavailable_bodies_do_not_invent_content` | pass |
| FID-010 | `FidelityAndQueueTests.FID_010_multibyte_text_uses_encoded_byte_count` | pass |
| FID-011, FID-012 | `FidelityAndQueueTests.FID_011_and_FID_012_respect_the_negotiated_one_mebibyte_body_boundary` | pass |
| FID-013, FID-014 | `HttpClientBodyCaptureTests.BRG_008_and_FID_013_and_FID_014_capture_finite_json_response_without_changing_host_visible_content` | pass |
| FID-015, FID-016, FID-017 | `FidelityAndQueueTests.FID_015_FID_016_and_FID_017_preserve_the_complete_header_array_without_an_allowlist` | pass |
| FID-018 | `HttpClientBodyCaptureTests.FID_018_gzip_xml_response_is_decoded_for_inspection_and_retains_original_wire_bytes` | pass |
| NIF-001, NIF-002 | `HttpClientBridgeTests.BRG_003_and_NIF_001_and_NIF_002_return_the_original_response_without_waiting_for_inspector_io` | pass |
| NIF-003, NIF-004 | `FidelityAndQueueTests.NIF_003_and_NIF_004_keep_queue_bounded_and_report_cumulative_drops_in_heartbeat` | pass |
| NIF-005 | `FidelityAndQueueTests.NIF_005_serialization_failure_is_local_and_does_not_throw_from_capture` | pass |
| NIF-006 | `HttpClientBridgeTests.BRG_003_and_NIF_001_and_NIF_002_return_the_original_response_without_waiting_for_inspector_io`, `BRG_004`, `BRG_005` | pass |
| NIF-007 | `FidelityAndQueueTests.NIF_007_excludes_the_inspector_endpoint_from_capture` | pass |
| REC-001, REC-003, REC-006 | `RecoveryTests.REC_001_REC_003_and_REC_006_reconnect_with_a_fresh_hello_and_recovery_snapshot_while_retaining_source_and_exchange_identity` | pass |
| REC-002, REC-004 | `RecoveryTests.REC_002_uses_bounded_exponential_backoff_and_REC_004_keeps_the_explicit_endpoint_pinned` | pass |
| REC-005 | Listener endpoint descriptor is not implemented by the product | pendingProductDependency |
| REC-007 | `AdapterLifecycleTests.HSK_008_stop_flushes_closes_and_is_idempotent` | pass |
| BRG-001 | `HttpClientBridgeTests.BRG_001_observes_mutations_from_earlier_handlers_at_the_final_supported_position` | pass |
| BRG-002 | `HttpClientBridgeTests.BRG_002_registration_appends_the_package_handler_after_existing_handlers` | pass |
| BRG-003 | `HttpClientBridgeTests.BRG_003_and_NIF_001_and_NIF_002_return_the_original_response_without_waiting_for_inspector_io` | pass |
| BRG-004 | `HttpClientBridgeTests.BRG_004_rethrows_the_original_error_after_capture_is_enqueued` | pass |
| BRG-005 | `HttpClientBridgeTests.BRG_005_preserves_native_cancellation_semantics` | pass |
| BRG-006 | `HttpClientBridgeTests.BRG_006_does_not_consume_a_one_shot_request_stream_and_reports_its_body_unavailable` | pass |
| BRG-007 | `HttpClientBodyCaptureTests.BRG_007_finite_request_body_is_captured_and_transport_receives_identical_bytes_and_headers` | pass |
| BRG-008 | `HttpClientBodyCaptureTests.BRG_008_and_FID_013_and_FID_014_capture_finite_json_response_without_changing_host_visible_content` | pass |
| BRG-009 | `HttpClientBodyCaptureTests.BRG_009_finite_binary_response_is_captured_once_and_host_receives_original_bytes` | pass |
| BRG-010 | `HttpClientBodyCaptureTests.BRG_010_unknown_length_finite_response_is_captured_at_eof_without_changing_bytes` | pass |
| BRG-011 | `HttpClientBodyCaptureTests.BRG_011_indefinite_response_is_not_eagerly_drained_or_completed_before_eof` | pass |
| BRG-012 | `HttpClientBodyCaptureTests.BRG_012_body_observation_failure_preserves_original_exception_and_reports_unavailable_body` | pass |
| BRG-013 | `HttpClientBridgeTests.BRG_013_collects_every_host_visible_general_and_content_header_without_an_allowlist` | pass |
| BRG-014 | `HttpClientBridgeTests.BRG_014_does_not_invent_headers_created_after_the_final_handler_seam`; the package README documents the primary-transport boundary | pass |
| DMC-001 | `HttpClientBridgeTests.BRG_015_global_registration_captures_every_factory_client_once_without_per_client_edits` | pass |
| DMC-002 | `HttpClientBridgeTests.BRG_017_real_direct_http_client_uses_the_runtime_diagnostic_bridge` | pass |
| DMC-003 | `HttpClientBridgeTests.BRG_019_real_direct_rest_sharp_client_uses_the_runtime_diagnostic_bridge` | pass |
| DMC-004 | `HttpClientBridgeTests.BRG_018_factory_and_runtime_diagnostic_bridges_do_not_duplicate_the_same_request` | pass |
| DMC-005 | `HttpInspectorWcfTests.WCF_001_attach_is_idempotent_for_generated_client_base_types`, `HttpInspectorWcfTests.WCF_002_attach_rejects_a_client_that_is_no_longer_in_the_created_state` | pass |
| DMC-006 | WCF message-inspector contract and reachable non-HTTP endpoint are not yet live-proven | pendingLiveEndpoint |
| DMC-007 | 2026-08-16 disposable v4 project: `pre-run.sh`, `dotnet build`, `post-run.sh`, and SHA-256 equality before/after | pass |
| DB-001 | `DatabaseCaptureTests.DB_001_sql_command_lifecycle_is_sent_when_the_listener_accepts_database_capture` | pass |
| DB-002 | `DatabaseCaptureTests.DB_002_database_capture_is_not_sent_when_the_listener_does_not_advertise_the_capability` | pass |
| DB-003 | `DatabaseCaptureTests.DB_003_database_queue_pressure_does_not_block_http_capture` | pass |
| INT-001 | `ListenerContractTests.INT_001_valid_hello_start_and_completion_are_acknowledged_and_stored_as_one_completed_exchange` | pass |
| INT-002 | `ListenerContractTests.INT_002_identical_requests_completed_in_reverse_order_remain_two_distinct_exchanges` | pass |
| INT-003 | `ListenerContractTests.INT_003_source_mismatch_returns_message_error` | pass |
| INT-004 | `ListenerContractTests.INT_004_unsupported_protocol_is_non_retryable_hello_error` | pass |
| INT-005 | `ListenerContractTests.INT_005_missing_hello_times_out_and_closes` | pass |
| INT-006 | `ListenerContractTests.INT_006_binary_frames_are_rejected_and_three_rejections_close_the_socket` | pass |
| INT-007 | `ListenerContractTests.INT_007_listener_accepts_one_mebibyte_and_rejects_one_mebibyte_plus_one` | pass |
| INT-008 | `ListenerContractTests.INT_008_disconnect_marks_an_in_flight_exchange_incomplete_and_newer_snapshot_restores_completion` | pass |
| INT-009 | `HttpClientNativeBodyCaptureTests.INT_009_native_http_client_captures_real_local_json_xml_and_binary_responses` | pass |
| INJ-001 | 2026-08-16 disposable v4 project was inspected, integrated with `pre-run.sh`, built against the bundled private feed, de-integrated with `post-run.sh`, then byte-compared with its starting files | pass |
| INJ-002 | No permanent integration-fixture suite is currently maintained; broader Bash variants remain intentionally deferred | deferred |

`CONTRACT-001` and `CONTRACT-002` are covered by `SchemaContractTests`; emitted hello/lifecycle messages and committed valid/invalid fixtures are validated against `contracts/http-inspector.v1.schema.json`.

The v4 integration smoke is run with disposable project and state directories under the operating system temporary directory. It must never mutate a consumer project in this repository.
