-- RF1.4.2.pages — page_tags, page_addressables, page_help → pages_*
-- All in mmff_vector. The pages table itself stays (root family).
BEGIN;

-- ── 1. page_tags → pages_tags ───────────────────────────────────
ALTER TABLE page_tags RENAME TO pages_tags;
ALTER TABLE pages_tags RENAME COLUMN tag_enum      TO pages_tags_tag_enum;
ALTER TABLE pages_tags RENAME COLUMN display_name  TO pages_tags_display_name;
ALTER TABLE pages_tags RENAME COLUMN default_order TO pages_tags_default_order;
ALTER TABLE pages_tags RENAME COLUMN is_admin_menu TO pages_tags_is_admin_menu;
ALTER TABLE pages_tags RENAME COLUMN created_at    TO pages_tags_created_at;

-- ── 2. page_addressables → pages_addressables ─────────────────
ALTER TABLE page_addressables RENAME TO pages_addressables;
ALTER TABLE pages_addressables RENAME COLUMN id            TO pages_addressables_id;
ALTER TABLE pages_addressables RENAME COLUMN parent_id     TO pages_addressables_id_parent;
ALTER TABLE pages_addressables RENAME COLUMN kind          TO pages_addressables_kind;
ALTER TABLE pages_addressables RENAME COLUMN name          TO pages_addressables_name;
ALTER TABLE pages_addressables RENAME COLUMN address       TO pages_addressables_address;
ALTER TABLE pages_addressables RENAME COLUMN page_route    TO pages_addressables_page_route;
ALTER TABLE pages_addressables RENAME COLUMN source        TO pages_addressables_source;
ALTER TABLE pages_addressables RENAME COLUMN custom_app_id TO pages_addressables_id_custom_app;
ALTER TABLE pages_addressables RENAME COLUMN soft_archived TO pages_addressables_soft_archived;
ALTER TABLE pages_addressables RENAME COLUMN last_seen_at  TO pages_addressables_last_seen_at;
ALTER TABLE pages_addressables RENAME COLUMN created_at    TO pages_addressables_created_at;
ALTER TABLE pages_addressables RENAME COLUMN updated_at    TO pages_addressables_updated_at;
ALTER TABLE pages_addressables RENAME COLUMN helpable       TO pages_addressables_helpable;

ALTER INDEX page_addressables_sibling_unique RENAME TO pages_addressables_sibling_unique;
ALTER INDEX page_addressables_root_unique    RENAME TO pages_addressables_root_unique;
ALTER INDEX page_addressables_address_idx    RENAME TO pages_addressables_address_idx;
ALTER INDEX page_addressables_route_idx      RENAME TO pages_addressables_route_idx;
ALTER INDEX page_addressables_gc_idx         RENAME TO pages_addressables_gc_idx;

-- Rename source CHECK, parent FK, and PK constraint.
DO $$
DECLARE
    src_check text;
    parent_fk text;
BEGIN
    SELECT conname INTO src_check FROM pg_constraint
        WHERE conrelid='pages_addressables'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%pages_addressables_source%';
    SELECT conname INTO parent_fk FROM pg_constraint
        WHERE conrelid='pages_addressables'::regclass AND contype='f'
          AND pg_get_constraintdef(oid) LIKE '%(pages_addressables_id_parent)%';
    IF src_check IS NOT NULL THEN
        EXECUTE format('ALTER TABLE pages_addressables RENAME CONSTRAINT %I TO pages_addressables_source_check', src_check);
    END IF;
    IF parent_fk IS NOT NULL THEN
        EXECUTE format('ALTER TABLE pages_addressables RENAME CONSTRAINT %I TO pages_addressables_id_parent_fkey', parent_fk);
    END IF;
END $$;

-- Trigger + function rename.
CREATE OR REPLACE FUNCTION pages_addressables_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.pages_addressables_updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS page_addressables_updated_at ON pages_addressables;
DROP FUNCTION IF EXISTS page_addressables_set_updated_at();

CREATE TRIGGER pages_addressables_updated_at
    BEFORE UPDATE ON pages_addressables
    FOR EACH ROW EXECUTE FUNCTION pages_addressables_set_updated_at();

-- ── 3. page_help → pages_help ────────────────────────────────
ALTER TABLE page_help RENAME TO pages_help;
ALTER TABLE pages_help RENAME COLUMN id                 TO pages_help_id;
ALTER TABLE pages_help RENAME COLUMN addressable_id     TO pages_help_id_pages_addressable;
ALTER TABLE pages_help RENAME COLUMN locale             TO pages_help_locale;
ALTER TABLE pages_help RENAME COLUMN body_html          TO pages_help_body_html;
ALTER TABLE pages_help RENAME COLUMN seeded_from        TO pages_help_seeded_from;
ALTER TABLE pages_help RENAME COLUMN library_ref        TO pages_help_id_library_help_default;
ALTER TABLE pages_help RENAME COLUMN soft_archived      TO pages_help_soft_archived;
ALTER TABLE pages_help RENAME COLUMN updated_at         TO pages_help_updated_at;
ALTER TABLE pages_help RENAME COLUMN updated_by_user_id TO pages_help_id_user_updater;
ALTER TABLE pages_help RENAME COLUMN created_at         TO pages_help_created_at;
ALTER TABLE pages_help RENAME COLUMN title              TO pages_help_title;
ALTER TABLE pages_help RENAME COLUMN video_embeds       TO pages_help_video_embeds;
ALTER TABLE pages_help RENAME COLUMN image_urls         TO pages_help_image_urls;

ALTER INDEX page_help_addressable_locale RENAME TO pages_help_id_pages_addressable_locale;
ALTER INDEX page_help_addressable_idx    RENAME TO pages_help_id_pages_addressable_idx;

DO $$
DECLARE
    seed_check text;
    addr_fk    text;
    lib_fk     text;
    user_fk    text;
BEGIN
    SELECT conname INTO seed_check FROM pg_constraint
        WHERE conrelid='pages_help'::regclass AND contype='c'
          AND pg_get_constraintdef(oid) LIKE '%pages_help_seeded_from%';
    SELECT conname INTO addr_fk FROM pg_constraint
        WHERE conrelid='pages_help'::regclass AND contype='f'
          AND pg_get_constraintdef(oid) LIKE '%(pages_help_id_pages_addressable)%';
    SELECT conname INTO lib_fk FROM pg_constraint
        WHERE conrelid='pages_help'::regclass AND contype='f'
          AND pg_get_constraintdef(oid) LIKE '%(pages_help_id_library_help_default)%';
    SELECT conname INTO user_fk FROM pg_constraint
        WHERE conrelid='pages_help'::regclass AND contype='f'
          AND pg_get_constraintdef(oid) LIKE '%(pages_help_id_user_updater)%';
    IF seed_check IS NOT NULL THEN EXECUTE format('ALTER TABLE pages_help RENAME CONSTRAINT %I TO pages_help_seeded_from_check', seed_check); END IF;
    IF addr_fk    IS NOT NULL THEN EXECUTE format('ALTER TABLE pages_help RENAME CONSTRAINT %I TO pages_help_id_pages_addressable_fkey', addr_fk);    END IF;
    IF lib_fk     IS NOT NULL THEN EXECUTE format('ALTER TABLE pages_help RENAME CONSTRAINT %I TO pages_help_id_library_help_default_fkey', lib_fk);  END IF;
    IF user_fk    IS NOT NULL THEN EXECUTE format('ALTER TABLE pages_help RENAME CONSTRAINT %I TO pages_help_id_user_updater_fkey', user_fk);          END IF;
END $$;

-- Trigger + function rename for pages_help. (Original re-uses the
-- page_help_set_updated_at function; create a new function bound to
-- the new column, swap the triggers, then drop the legacy function.)
CREATE OR REPLACE FUNCTION pages_help_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.pages_help_updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- library_help_defaults: also uses page_help_set_updated_at. Its
-- updated_at column is still bare per the spec note in §2.8 — but
-- the trigger references the function we are about to drop. Re-bind
-- it to its own function so library_help_defaults stays working.
CREATE OR REPLACE FUNCTION library_help_defaults_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS page_help_updated_at               ON pages_help;
DROP TRIGGER IF EXISTS library_help_defaults_updated_at   ON library_help_defaults;
DROP FUNCTION IF EXISTS page_help_set_updated_at();

CREATE TRIGGER pages_help_updated_at
    BEFORE UPDATE ON pages_help
    FOR EACH ROW EXECUTE FUNCTION pages_help_set_updated_at();
CREATE TRIGGER library_help_defaults_updated_at
    BEFORE UPDATE ON library_help_defaults
    FOR EACH ROW EXECUTE FUNCTION library_help_defaults_set_updated_at();

COMMIT;
