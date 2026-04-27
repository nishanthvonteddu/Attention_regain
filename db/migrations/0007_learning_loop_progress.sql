-- Day 10 learning-loop progress indexes.
-- The durable contract remains event-sourced through study_interactions; reads derive
-- progress, weak-card resurfacing, and latest action state from these ordered events.

CREATE INDEX IF NOT EXISTS study_interactions_card_type_created_idx
  ON study_interactions(card_id, interaction_type, created_at DESC);

CREATE INDEX IF NOT EXISTS study_cards_document_status_sequence_idx
  ON study_cards(document_id, status, sequence);
