# BGG API Test Fixtures

These XML fixtures are structurally faithful to the BGG XML API v2 format but were
hand-crafted because the BGG API was not reachable at build time (network proxy 403).

They include the fields the parser extracts plus surrounding context fields
(boardgameartist links, suggested_playerage and language_dependence polls) that real
responses contain but the parser currently ignores.

**TODO:** Replace with captured real API responses when network access is available:

```bash
curl -o thing-wingspan-266192.xml "https://boardgamegeek.com/xmlapi2/thing?id=266192&stats=1&type=boardgame"
curl -o thing-gloomhaven-174430.xml "https://boardgamegeek.com/xmlapi2/thing?id=174430&stats=1&type=boardgame"
curl -o search-wingspan.xml "https://boardgamegeek.com/xmlapi2/search?query=Wingspan&type=boardgame"
# Collection requires auth token:
curl -H "Authorization: Bearer TOKEN" -o collection-testuser.xml "https://boardgamegeek.com/xmlapi2/collection?username=testuser&own=1&subtype=boardgame&stats=1"
```
