This hotfix fixes stale collector records remaining on the iPhone after the public feed was corrected.

Root cause:
The app merged new remote records into localStorage but never removed remote records that disappeared from lottery-feed.json. Therefore old polluted Hobby Station records remained visible even after collector/feed corrections.

Fix:
- Treat a successful non-empty public feed as authoritative for auto-collected remote records.
- Remove only stale remote records absent from the latest feed.
- Preserve local entries and user-created data.
- Avoid deletion when the feed is empty or failed.
- Avoid deleting administrator-published data when its API sync fails.
- Carry user status across a unique same-URL/shop/deadline correction.
- Never auto-merge ambiguous variants.
- Show how many old records were cleaned.

Verification:
- 61/61 automated tests passed.
- Project layout check passed.
- Public privacy check passed.
- Browser inline JavaScript syntax check passed.
