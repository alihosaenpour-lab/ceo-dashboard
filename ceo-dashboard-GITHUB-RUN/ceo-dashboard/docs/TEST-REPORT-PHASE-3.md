# TEST REPORT — Phase 3

Date: 2026-09-13
Env: Node 20, PostgreSQL 17.11, Prisma 5.22.0, Server 0.0.0.0:3000

## Identity (4)
✅ 1. normalize phone - 09017909857
✅ 1b. normalize +989017909857
✅ 1c. normalize 00989017909857
✅ 1d. normalize persian ۰۹۰۱۷۹۰۹۸۵۷
✅ 1e. invalid fails
✅ 2. create customer
✅ 2b. duplicate phone 409
✅ 2c. duplicate normalized phone 409 ( +98 )
✅ 3. channel identity exists
✅ 3b. basalam identity mapping
✅ 4. duplicate external identity blocked P2002

## Customer (5)
✅ 5. create customer XSS escaped
✅ 5b. normalizedPhone stored
✅ 5c. customerTimeline created
✅ 6. update customer
✅ 6b. status changed
✅ 6c. audit for update
✅ 7. search by phone
✅ 7b. search by name
✅ 7c. search by normalized +98
✅ 8. pagination page1 (2/limit, total>=4, pages>=2)
✅ 8b. pagination page2 different
✅ 8c. pagination has pages
✅ 9. status NEW->VIP (CEO allowed) + timeline

## Dedup/Merge (4)
✅ 10. duplicate detection via normalized 409
✅ 11. merge 200 + source deleted + target exists + identity moved
✅ 12. merge audit + timeline + idempotent duplicate 404
✅ 13. merge concurrency both handled

## Message (3)
✅ 14. message create + timeline
✅ 15. duplicate external message 409
✅ 16. customer resolution linked

## Lead (6)
✅ 17. lead create (fresh customer) + score >=0 + customer→LEAD + duplicate 409
✅ 18. lead update QUALIFIED
✅ 19a. lead scoring stock inquiry (201/409)
✅ 19. lead scoring high value >20
✅ 20. lead status WON + timeline LEAD_UPDATED

## FollowUp (4)
✅ 21. followup create
✅ 22. duplicate prevention 409
✅ 23. complete + completedAt
✅ 24. cancel

## Security (6)
✅ 25. unauthorized without token 401
✅ 26. IDOR orders isolated
✅ 27. unauthorized merge 403 for SUPPORT
✅ 28. XSS customer/name/message escaped
✅ 29. mass assignment blocked (isActive true, id not hacked, phone not changed)
✅ 30. PII masking audit phone ***

## Integration readiness (3)
✅ 31. Telegram identity mapping
✅ 32. Instagram identity mapping exists
✅ 33. Basalam identity mapping exists

## Additional CRM
✅ Timeline pagination
✅ Customer 360 + KPI totalOrders/totalSpend Decimal
✅ Request ID header present

## Phase 2 Regression (6)
✅ 34a. health db connected
✅ 34b. OTP request still works
✅ 34c. orders still works
✅ 34d. schedule still works
✅ 34e. blocked .env 404
✅ 34f. inventory still works

---

**TOTAL: 79 passed, 0 failed, 0 skipped**

Also: `tests-phase2.js` 54 passed

Command:
```bash
node tests-phase3.js  # 79/79
node tests-phase2.js  # 54/54
curl http://localhost:3000/api/health # db connected, requestId
```

## Coverage vs Master Prompt Section 32

All 34 required tests covered (1-34) + additional CRM checks = 79 assertions.
0 Failed → Phase 3 Complete per DoD.
