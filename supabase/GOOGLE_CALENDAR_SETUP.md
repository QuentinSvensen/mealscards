# Google Agenda (lecture seule) — configuration

## 1. SQL (Dashboard Supabase → SQL Editor)

Exécuter le script :

`supabase/sql/google_calendar_connections.sql`

## 2. Google Cloud Console

1. Créer un projet (ou réutiliser un existant).
2. Activer **Google Calendar API**.
3. Écran de consentement OAuth (type External ou Internal).
4. Créer des identifiants **OAuth 2.0 Client ID** (application Web).
5. URI de redirection autorisée :

`https://<PROJECT_REF>.supabase.co/functions/v1/google-calendar-oauth-callback`

## 3. Secrets Supabase (Edge Functions)

```bash
supabase secrets set GOOGLE_CLIENT_ID=...
supabase secrets set GOOGLE_CLIENT_SECRET=...
supabase secrets set GOOGLE_REDIRECT_URI=https://<PROJECT_REF>.supabase.co/functions/v1/google-calendar-oauth-callback
supabase secrets set GOOGLE_APP_REDIRECT=http://localhost:3000/planning
```

En production, `GOOGLE_APP_REDIRECT` doit pointer vers l’URL publique `/planning`.

## 4. Déployer les Edge Functions

```bash
supabase functions deploy google-calendar-oauth-start
supabase functions deploy google-calendar-oauth-callback
supabase functions deploy google-calendar-events
supabase functions deploy google-calendar-disconnect
supabase functions deploy google-calendar-status
```

La function `google-calendar-oauth-callback` doit être invocable sans JWT (redirect navigateur Google).
Dans le dashboard : désactiver « Verify JWT » pour `google-calendar-oauth-callback` uniquement.

## Comportement

- Lecture seule des événements du calendrier primary.
- Aucune écriture dans Google Agenda.
- Les repas / extras restent gérés dans MealsCards (sync Planning classique).
