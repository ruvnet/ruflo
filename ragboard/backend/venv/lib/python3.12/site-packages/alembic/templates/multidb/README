Rudimentary multi-database configuration.

Multi-DB isn't vastly different from generic. The primary difference is that it
will run the migrations N times (depending on how many databases you have
configured), providing one engine name and associated context for each run.

That engine name will then allow the migration to restrict what runs within it to
just the appropriate migrations for that engine. You can see this behavior within
the mako template.

In the provided configuration, you'll need to have `databases` provided in
alembic's config, and an `sqlalchemy.url` provided for each engine name.
