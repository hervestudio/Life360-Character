/*
  # Require age and gender for head (hair) assets

  ## Summary
  Head assets now carry an age_group and gender, same as body. This lets the client filter and recommend head assets that match the selected body.

  ## Changes
    1. Drop the old body_requires_age_gender constraint.
    2. Backfill existing hair rows with adult/male defaults where NULL.
    3. Add new constraint: both body and hair rows must have age + gender set; other categories must keep them NULL.

  ## Notes
    1. No data loss. Existing hair rows are updated in place only where age/gender are currently NULL.
*/

alter table assets drop constraint if exists body_requires_age_gender;

update assets
set age = coalesce(age, 'adult'::age_group),
    gender = coalesce(gender, 'male'::gender)
where category = 'hair';

alter table assets
  add constraint body_requires_age_gender check (
    (category in ('body', 'hair') and age is not null and gender is not null)
    or (category not in ('body', 'hair') and age is null and gender is null)
  );
