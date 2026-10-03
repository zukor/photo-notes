# Shared Pro camera readers

The existing Plan or Sketch, Business Card, Equipment Plate, Material Label, and Gauge & Instrument readers share the existing reader API, vision pipeline, editable review, confidence, source photographs, and camera_readings storage.

Eligible editions: Photo Notes Pro, Paving Pro, Concrete Pro, Property Manager Pro, HOA Maintenance Pro, General Contractor Pro, and Roofer Pro. Basic, Issue Reporter, and Road Issue Reporter are excluded on client and server.

Access: the existing account-level feature_access.camera_readers setting applies to all eligible editions. Missing settings retain the existing default of enabled; explicit false disables the readers. Administrators can configure Camera Readers & Scanners for an account with any eligible edition grant. Updating visible feature settings merges them with stored settings so hidden Paving options are preserved. Edition access grants and authentication are unchanged.

Entry: Capture > Camera Tools in the six non-Paving Pro editions. Paving retains its Photo Reason choices and Open Camera Tools guide. All entries use the same renderer and extraction schemas.

Equipment prompt removes the paving-contractor assumption. Material labels include business and maintenance materials. Instruments are described generically. Plan and business-card schemas and prompts are unchanged. Multiple dials, ambiguity notes, exact displayed units, and no calculated dimensions remain intact.

A scan creates a draft with its source photo. The user edits and saves it, including manual entry when AI returns no extraction. Open in Photo Library is an explicit separate action that creates a linked capture once, using the same source photograph and reviewed fields as notes. Repeating the action opens that capture. Existing captures and readings are user-scoped, not edition-tagged; no Paving default or edition migration is introduced. The current edition remains selected when the library opens. All record queries retain user ownership predicates, and only reviewed saved records can be published.

Paving ticket scanning and pavement classification retain their Paving gates. Measure From Photo and Concrete measurement behavior from current main are preserved.

Verification: test/shared-camera-readers.test.js executes the actual feature gates and reader handlers with isolated database/vision doubles. scripts/test-shared-camera-readers.cjs exercises both browser engines at phone/desktop widths across all seven editions, reader selection, editable manual fallback, explicit publishing, account opt-out, and excluded editions. These checks make no paid AI calls. Physical camera capture and real image extraction still require device acceptance testing.
