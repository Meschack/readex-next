use chrono::Utc;
use rusqlite::{params, Connection};

pub(super) fn insert_event(
    connection: &Connection,
    name: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    let occurred_at = Utc::now().to_rfc3339();
    let id = format!("{name}-{occurred_at}");

    connection
        .execute(
            "INSERT INTO domain_events (id, name, occurred_at, payload_json)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, name, occurred_at, payload.to_string()],
        )
        .map(|_| ())
        .map_err(|_| "We couldn't save the library update.".to_string())
}

pub(super) fn insert_renderer_event(
    connection: &Connection,
    id: &str,
    name: &str,
    occurred_at: &str,
    payload: &serde_json::Value,
) -> Result<(), String> {
    const ALLOWED_EVENTS: [&str; 4] = [
        "AudioPreparationRequested",
        "SentenceAudioReady",
        "AudioPreparationFailed",
        "WordInspected",
    ];

    if !ALLOWED_EVENTS.contains(&name) || id.len() > 128 || occurred_at.len() > 64 {
        return Err("That reader update was not recognized.".to_string());
    }

    let payload_json = payload.to_string();
    if payload_json.len() > 16_384 {
        return Err("That reader update was too large.".to_string());
    }

    connection
        .execute(
            "INSERT INTO domain_events (id, name, occurred_at, payload_json)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, name, occurred_at, payload_json],
        )
        .map(|_| ())
        .map_err(|_| "We couldn't save the reader update.".to_string())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use serde_json::json;

    use super::insert_renderer_event;

    #[test]
    fn renderer_events_are_allowlisted_and_persisted() {
        let connection = Connection::open_in_memory().expect("database should open");
        connection
            .execute_batch(
                "CREATE TABLE domain_events (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    payload_json TEXT NOT NULL
                );",
            )
            .expect("event table should exist");

        insert_renderer_event(
            &connection,
            "event-1",
            "WordInspected",
            "2026-07-10T00:00:00.000Z",
            &json!({ "surface": "bonjour" }),
        )
        .expect("known event should persist");

        let count = connection
            .query_row("SELECT COUNT(*) FROM domain_events", [], |row| {
                row.get::<_, i64>(0)
            })
            .expect("event count should read");
        assert_eq!(count, 1);
        assert!(insert_renderer_event(
            &connection,
            "event-2",
            "ArbitraryRendererEvent",
            "2026-07-10T00:00:00.000Z",
            &json!({})
        )
        .is_err());
    }
}
