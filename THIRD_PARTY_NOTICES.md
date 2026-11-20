# Third-party notices

LogiTrack's own source code is released under the [MIT License](LICENSE). It depends on open-source packages that keep their own licences. This summary covers the **direct** dependencies listed in `package.json`, checked against each package's `license` field on 19 Nov 2026. It is not legal advice; check the licences yourself before redistributing.

| Licence | Packages |
| --- | --- |
| MIT | next, react, react-dom, socket.io, socket.io-client, recharts, zod, date-fns, otpauth, uqr, sonner, clsx, tailwind-merge, server-only, @radix-ui/* (6 packages), tailwindcss, @tailwindcss/turbopack; development: vitest, eslint, eslint-config-next, jsdom, tsx, cross-env, @vitejs/plugin-react, @testing-library/*, @types/* |
| Apache-2.0 | @prisma/client, prisma, class-variance-authority; development: typescript, @playwright/test |
| BSD-3-Clause | bcryptjs |
| BSD-2-Clause | leaflet |
| ISC | lucide-react |
| SIL Open Font License 1.1 | geist (fonts) |
| **Hippocratic License 2.1** | **react-leaflet** |
| MPL-2.0 | @axe-core/playwright (development and testing only, not shipped) |

## Notes

- **react-leaflet (Hippocratic License 2.1)** is not an OSI-approved open-source licence. It permits use but adds conditions based on human-rights standards. If you redistribute LogiTrack or build on it commercially, review that licence. The map could be rebuilt directly on Leaflet (BSD-2-Clause) if you need to avoid it.
- **Map tiles** come from OpenStreetMap's public tile servers. OpenStreetMap data is © OpenStreetMap contributors under the ODbL. The map shows the required attribution. Heavy use must follow the [OSMF tile usage policy](https://operations.osmfoundation.org/policies/tiles/).
- **Routing** (optional, `ROUTING_PROVIDER=osrm`) uses the public OSRM demo server, which is meant for light, non-commercial use. LogiTrack works fully offline without it.
