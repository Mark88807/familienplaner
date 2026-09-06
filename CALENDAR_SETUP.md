# Persönliche Kalenderfeeds einrichten

Der Workflow veröffentlicht die bestehende App zusammen mit den zur Laufzeit erzeugten ICS-Dateien als GitHub-Pages-Artifact. Keine ICS-Datei und kein geheimer Pfad wird in Git eingecheckt.

## Benötigte GitHub-Secrets

- `FIREBASE_API_KEY`: Firebase-Web-API-Key, der für den REST-Login benötigt wird.
- `FIREBASE_DATABASE_URL`: URL der Realtime Database, ohne abschließenden Slash.
- `FIREBASE_EXPORT_EMAIL`: E-Mail des technischen Firebase-Auth-Benutzers.
- `FIREBASE_EXPORT_PASSWORD`: Passwort dieses Benutzers.
- `FIREBASE_FAMILY_ID`: der geheime Familiencode beziehungsweise Firebase-Schlüssel unter `families/`.
- `CALENDAR_FEEDS_JSON`: Zuordnung der Firebase-Personen-ID zu einem langen, zufälligen relativen ICS-Pfad.

Die Zuordnung muss jedes aktuell vorhandene Familienmitglied enthalten. Bei einer neu angelegten Person bricht der Export absichtlich ab, bis ein geheimer Pfad ergänzt wurde; dadurch entsteht kein versehentlich öffentlicher oder gemeinsam genutzter Ersatzpfad.

Beispiel für `CALENDAR_FEEDS_JSON` (nur als Form, nicht mit diesen Werten verwenden):

```json
{
  "kind2": "calendar/0123456789abcdef0123456789abcdef/calendar.ics",
  "mama": "calendar/fedcba9876543210fedcba9876543210/calendar.ics"
}
```

Für jeden Pfad mindestens 128 Bit Zufall verwenden, etwa mit `openssl rand -hex 16`. Die persönliche Android-Abonnementadresse lautet anschließend:

```text
https://<github-name>.github.io/<repository>/<geheimer-pfad>.ics
```

In einer Kalender-App, die Webcal-Abonnements unterstützt, kann dasselbe Ziel mit dem Schema `webcal://` eingetragen werden. Google Kalender auf Android übernimmt abonnierte Kalender üblicherweise über das Google-Konto; das Abonnement wird dabei in der Weboberfläche von Google Kalender hinzugefügt und danach mit Android synchronisiert.

## Android-Erinnerungen

Die Feeds enthalten beide angeforderten `DISPLAY`-Alarme. Das ist trotzdem keine Zustellgarantie: RFC 5545 erlaubt Kalenderprogrammen, Alarme aus externen Quellen aus Sicherheitsgründen zu ignorieren. Insbesondere sollte bei Google Kalender nicht darauf vertraut werden, dass `VALARM` aus einem URL-Abonnement unverändert als Gerätebenachrichtigung übernommen wird. Das URL-Abonnement muss zunächst in der Google-Kalender-Weboberfläche eingerichtet werden; die Android-App kann neue externe Abonnements nicht selbst anlegen. Danach für den abonnierten Kalender in Google Kalender eigene Standardbenachrichtigungen aktivieren und mit einem Testtermin prüfen. Damit bleibt Brave vollständig außerhalb der Erinnerungskette.

## Firebase-Berechtigung

Der technische Benutzer wird per Firebase Authentication angemeldet; die Realtime Database wertet sein ID-Token mit den normalen Rules aus. `database.rules.json` sperrt Schreibzugriffe dieses Benutzers, während die anonyme Anmeldung der bestehenden App weiter funktioniert.

Die Rules werden nicht vom Pages-Workflow verändert. Nach Prüfung im Firebase-Projekt werden sie separat aktiviert:

```bash
firebase deploy --only database --project familienplaner-neu
```

Die Regel ist bewusst kompatibel zur bestehenden, anonym authentifizierten Web-App. Sie verhindert Schreibzugriffe des Export-Benutzers und verlangt 36-stellige Familien-IDs. Eine echte Benutzer-zu-Familie-Autorisierung wäre stärker, benötigt aber eine Migration des bestehenden Zugriffsmodells und ist nicht ohne Risiko als reine Rules-Änderung möglich.

## GitHub Pages

Unter **Settings → Pages → Build and deployment → Source** muss **GitHub Actions** gewählt sein. Der Zeitplan läuft bei Minute 17 und 47; GitHub garantiert bei geplanten Workflows keine sekundengenaue Ausführung.

Lokal lassen sich die reinen Generator-Tests ohne Zugangsdaten ausführen:

```bash
node --test scripts/generate-calendars.test.mjs
```
