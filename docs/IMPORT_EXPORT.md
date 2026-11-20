# Import and export

**Insights → Import & Export** brings records in from CSV files and downloads them in the same format. Reports (analytics, driver performance, fuel efficiency, the activity log) stay on the **Reports** page. They are summaries for a date range, formatted for reading rather than re-importing.

## Who can do what

| Data | Import (needs) | Export (needs) | Super Admin | Fleet Manager | Dispatcher | Driver |
| --- | --- | --- | --- | --- | --- | --- |
| Vehicles | `vehicles:write` | `vehicles:read` | Both | Both | Export | No |
| Drivers | `drivers:write` | `drivers:read` | Both | Both | Export | No |
| Deliveries | `deliveries:write` | `deliveries:read` | Both | Both | Both | No |
| Fuel records | `fuel:write` | `fuel:read` | Both | Both | No | No |
| Maintenance | `maintenance:write` | `maintenance:read` | Both | Both | No | No |

Permissions are checked on the server for every request. The page only shows what your role may use.

## How an import works

1. **Choose the data type and a CSV file** (UTF-8, header row, up to 5,000 rows and 5 MB). Download the template to get the exact columns. Column order does not matter. Headers are matched ignoring case, spaces and punctuation, and the column names used by the Reports exports (e.g. `Registration`, `Vehicle`) are also accepted. Unknown columns are listed and ignored.
2. **Check file.** Every row goes through:
   - the **same Zod schema** as the form for that record,
   - **duplicate detection** inside the file and against the database,
   - the **same service function** that the form uses to save, inside a transaction that is **always rolled back**. Business rules (tank capacity, fuel odometer order, a vehicle on a delivery cannot start maintenance, unique licence numbers…) are therefore checked exactly, not approximated.

   The result lists each line with **Ready**, **Error** or **Duplicate** and the reason, by column.
3. **Import.** You confirm in a dialog. The file is read and validated **again** on the server (nothing from the preview is trusted), and all rows are saved in **one transaction**:
   - By default, **if any row has a problem, nothing is imported.**
   - You can tick **"Skip the rows with problems and import the rest"**. The skipped rows are listed and nothing is dropped without being shown.
   - If anything fails while saving, the whole import is rolled back.
4. **Cancel / Start over** discards the file. Previews never change data.

Each import writes one activity-log entry, e.g. `Imported 48 vehicles from "fleet.csv" (2 rows skipped)`, and a structured server log line. Imports are limited to 20 per minute per user.

### What an import never does

- It never updates or deletes existing records. A record that already exists is reported as a duplicate.
- It never imports passwords. A `Password` column is ignored. Create driver logins from the Drivers page.
- It never assigns drivers or vehicles, or imports delivery history. Deliveries are created as **Pending** and assigned in the app, so the delivery workflow and its checks stay in charge. Their route is the offline estimate (no network call). With `ROUTING_PROVIDER=osrm` the simulator upgrades it to road geometry later.

## Columns

Required columns are marked ✓. Dates accept `YYYY-MM-DD`, `YYYY-MM-DD HH:MM` and Indian day-first `DD/MM/YYYY` (or `DD-MM-YYYY`). Numbers may contain thousands separators and `₹`. Choice fields accept the label shown in the app (`Mini Truck`, `Oil Change`) or the internal value (`MINI_TRUCK`).

### Vehicles

| Column | ✓ | Notes |
| --- | --- | --- |
| Registration Number | ✓ | e.g. `MH 12 AB 1234`; unique (also against deleted vehicles) |
| Name | ✓ | |
| Type | ✓ | Truck, Mini Truck, Van, Pickup, Two-Wheeler, Container |
| Manufacturer, Model | ✓ | |
| Year | ✓ | 1990 to next year |
| Fuel Type | ✓ | Diesel, Petrol, CNG, Electric |
| Fuel Capacity (L) | ✓ | litres (kWh for electric) |
| Odometer (km) | ✓ | whole km |
| Status | | Available (default), Maintenance, Inactive |
| Insurance Expiry, Registration Expiry | ✓ | dates |

Duplicate key: registration number.

### Drivers

Full Name ✓, Email ✓ (unique), Phone ✓ (Indian mobile), Address ✓, License Number ✓ (e.g. `MH12 2019 0045678`, unique), License Expiry ✓, Joining Date ✓, Status (Available, Off Duty, Inactive). Duplicate key: email or licence number.

### Deliveries

Customer Name ✓, Customer Phone ✓, Pickup Address ✓, Pickup Latitude ✓, Pickup Longitude ✓, Destination Address ✓, Destination Latitude ✓, Destination Longitude ✓, Scheduled At ✓, Expected At ✓ (after Scheduled At), Priority (Low, Normal, High, Urgent), Notes. Duplicate key: customer phone + destination + scheduled time (in the file); customer name + destination + scheduled time (against the database).

### Fuel records

Vehicle Registration ✓ (an existing vehicle), Date ✓ (not in the future), Quantity (L) ✓, Price per Litre (INR) ✓, Odometer (km) ✓ (must fit between the vehicle's earlier and later fills), Station ✓, Notes. Duplicate key: vehicle + day + odometer.

### Maintenance records

Vehicle Registration ✓, Type ✓ (General Service, Oil Change, Tyre Replacement, Brake Service, Engine Work, Battery, Inspection, Repair), Description ✓, Service Date ✓, Status (Scheduled, In Progress, Completed, Cancelled), Cost (INR), Provider ✓, Odometer (km), Next Service Date, Next Service Odometer. Completed records keep their service date as the completion date. Duplicate key: vehicle + type + service day.

## Export

The **Export** tab downloads records in the import format, so a file can be edited and imported elsewhere. Filters: text search (vehicles, drivers, deliveries), status, and a date range (deliveries by scheduled date, fuel by date, maintenance by service date).

API, for scripts and selected-record exports:

```
GET /api/data/{vehicles|drivers|deliveries|fuel|maintenance}/export?q=&status=&from=YYYY-MM-DD&to=YYYY-MM-DD&ids=id1,id2
GET /api/data/{type}/template
POST /api/data/{type}/import   { "csv": "...", "fileName": "x.csv", "commit": false, "skipInvalid": false }
```

Exports never contain password hashes, tokens, two-factor data or internal IDs. Text cells starting with `= + - @` are prefixed with `'` against spreadsheet formula injection, and the importer removes that prefix again. Files start with a UTF-8 BOM so Excel shows `₹` and Indian names correctly. Every export is recorded in the activity log.

## Tested behaviour

`tests/integration/imports.test.ts` (13 tests) covers the RFC 4180 parser (quotes, embedded commas and line breaks, BOM, CRLF), strict date and number parsing, preview without writes, all-or-nothing commits, skip-invalid commits, duplicates in the file and in the database, missing columns, permissions, fuel and maintenance business rules, password columns being ignored, export/re-import round trips and selected-record export. `tests/e2e/v3.spec.ts` imports a file through the UI as a Fleet Manager.

## Limitations

- No column-mapping screen: headers must match the template (or a known alias). Rename columns in the spreadsheet if needed.
- One transaction holds the database write lock while the file is processed. A 1,000-row file takes a few seconds. Other writes wait during that time.
- Imports create records only. Updating existing records from a file is not supported.
- Selecting individual rows for export is available through the API (`ids=`), not as checkboxes in the list pages.
