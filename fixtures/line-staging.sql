-- Apply only to pickleball-line-staging, never to the production database.
-- Fictitious roster for LINE connection/review checks. Existing data is not replaced.
INSERT INTO pickleball_shared_schedules (id, payload, checked_matches, created_at, updated_at)
VALUES (
  'LineTest01',
  '{"title":"LINE connection test (sample data)","names":["Sample 1","Sample 2","Sample 3","Sample 4","Sample 5","Sample 6","Sample 7","Sample 8"],"matches":[{"match":1,"courts":[{"court":1,"teamA":[0,1],"teamB":[2,3]}],"resting":[4,5,6,7]},{"match":2,"courts":[{"court":1,"teamA":[4,5],"teamB":[6,7]}],"resting":[0,1,2,3]},{"match":3,"courts":[{"court":1,"teamA":[0,2],"teamB":[4,6]}],"resting":[1,3,5,7]},{"match":4,"courts":[{"court":1,"teamA":[1,3],"teamB":[5,7]}],"resting":[0,2,4,6]},{"match":5,"courts":[{"court":1,"teamA":[0,3],"teamB":[5,6]}],"resting":[1,2,4,7]}]}',
  '[1]',
  '2026-11-05T00:00:00.000Z',
  '2026-11-05T00:00:00.000Z'
)
ON CONFLICT(id) DO NOTHING;
