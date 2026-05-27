-- ============================================================
-- down/136_restore_padmin_pre_fold_nav.sql
--
-- Rollback for 136_restore_padmin_pre_fold_nav.sql.
--
-- Deletes by exact UUID. The padmin "Default" nav profile
-- (cf5a76fb-…) is preserved — it was NOT created by 136.
--
-- ORDER: nav_prefs → profile_groups → nav_profiles → custom_pages
-- (children before parents to respect FK ON DELETE).
-- ============================================================

BEGIN;

DELETE FROM users_nav_prefs WHERE users_nav_prefs_id IN (
    -- Megans Group (4c0505f9)
    '556e6074-14b8-4f8e-a4a2-035352e4eb8f','9ae6ca37-eab7-4acc-8973-4e4eb52c16ec',
    '106bcedf-f849-4877-a9a3-e26569920d43','467a7c59-cec5-4d46-b666-c67f4b68d8fb',
    '7f8e8e69-b682-407c-828e-dc63b3a82469','115e3f20-cab9-4f79-acee-e0dd696a3b62',
    'e849140b-1a17-414c-9a0e-38b1b14e6aea','444a4be9-73d1-4732-ac77-b8ae44722024',
    '3393faab-cd29-4ac4-ac51-d769b33b8fc1','bd61bf9e-aeec-4257-8a68-c0008f285f76',
    '67d2b80f-54d1-4a79-b06f-0efe9cdce618','33848cfb-06dc-458b-a323-c5619455f70e',
    'ef5c90fb-67f1-4979-b060-86f9d5f35908','d12a8a70-ab72-4e34-a139-8afc4ca2ae3b',
    '2fbcd0eb-3107-49c9-9205-d8a51ccbeed5','3f6de419-1a47-447b-a3b0-ec5397a098ae',
    '25ae4b74-b14b-4995-a8ca-d78c00d7bdb5','3ed85cf1-1fb2-44d2-921c-76f6c21548e2',
    '56f5002c-b632-4b94-87a8-911d92abdab0','83a79a3b-e75a-40b6-bfe4-5743c08951f0',
    '814aeb0b-77a9-49cf-9405-54ebfced366c','09e5c5e0-ec0c-4883-a64a-3e05bcbc2e9a',
    -- Themes (77df245f)
    'a9c166ff-8ef3-4b8c-b640-38aea9581adb','f772d9d3-6f0f-4edf-9718-ce7124fe8b41',
    '114322a9-a308-4088-819d-0089c569dd02','4d61c312-10f6-41a6-8334-02927ad17de8',
    '60477ee4-5925-426f-95e3-1a4a7f520c9f','74394bdd-0ae8-4053-8711-119079212730',
    '065180ef-6edf-49bb-ba0a-68e3c3b40372','0554ee1d-a53b-470f-b5f1-1c2f6c22c06e',
    '9b97c175-51ec-4b8c-a9f3-106e3fce67b6',
    -- New Group (3b0cd57b)
    '683a639a-1ca3-4525-9aed-d517345d22fc','eb2d7f40-8237-46fb-8f24-82af831a60d4',
    '3eab6579-f8ae-489e-9229-c8084df94930','473281c9-664c-4741-b232-a7c9d7204893',
    'e27a42ce-0c61-4508-bb00-a62702d98710','e97cf8b7-5eb9-4bdf-a186-0e7662840368',
    '097dc85c-7f57-49f8-b3e6-c6db8547a083','7d68a9f2-90b1-4096-9753-f1de1c56811f',
    '3fa42d1d-55f9-46d1-8654-5277e3673183'
);

DELETE FROM users_nav_profile_groups
WHERE users_nav_profile_groups_id_profile IN (
    '77df245f-7b05-4d52-90d4-956bd23b1d4f',
    '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f',
    '3b0cd57b-779e-4a96-ac4f-91242286ebcf'
);

DELETE FROM users_nav_profiles WHERE users_nav_profiles_id IN (
    '77df245f-7b05-4d52-90d4-956bd23b1d4f',
    '4c0505f9-c9dd-47aa-b7d3-030d27d20c0f',
    '3b0cd57b-779e-4a96-ac4f-91242286ebcf'
);

DELETE FROM users_custom_pages WHERE users_custom_pages_id IN (
    '19f62bcc-82c0-44b2-b878-388041ff7b5d',
    '0980b2ae-c2e0-44cd-be16-05f156ded545',
    'df41f0d9-ed1d-43bf-8cbe-c36cfb789380'
);

COMMIT;
