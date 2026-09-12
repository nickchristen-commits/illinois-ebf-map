# Illinois School Funding Adequacy Map

A static, host-ready interactive map using the FY2027 Illinois Evidence-Based Funding data supplied in the project workbook.

## What is included

- `index.html` — public-facing map page
- `styles.css` — responsive styling
- `app.js` — map behavior, search, filters, boundary matching, detail panel
- `data/ebf_data.js` — 851 Illinois school-district records extracted from the supplied workbook

The 13 non-district/special entities in the workbook that do not have a standalone FY2027 EBF tier were intentionally excluded from the map dataset. The resulting 851 records correspond to school districts with FY2027 EBF calculations.

## Features

- Actual school-district polygons using the current NCES EDGE 2024–25 boundary service
- Color map by:
  - FY2027 percentage of adequacy
  - funding gap per enrolled student
  - change in adequacy from FY2026
- Search by district, city, county, or IFT local number
- Filter to unit, elementary, or high-school districts
- Filter to IFT-AFT districts only
- Click-through detail panel with:
  - FY27 adequacy percentage and tier
  - funding gap
  - gap per student
  - calculated new FY27 funding
  - enrollment
  - FY26 comparison
  - state representative and senator
  - selected student demographics

## Hosting

This is a static site and requires no backend. Upload the full folder to any static host, including:

- GitHub Pages
- Netlify
- Vercel
- Cloudflare Pages
- an IFT-managed web server

The site needs normal internet access because it loads Leaflet, OpenStreetMap tiles, and NCES district boundaries from public CDNs/services.

## Local testing

Because browsers often block local `file://` access, run a simple local web server from this folder. For example, with Python installed:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000`.

## Data notes

Funding data comes from the uploaded workbook:
`FY 2027 School Districts with Tier, Adequacy, FY 2026 Data, Union Number, Reps and Senators, and Enrollment and Demographic Data(1).xlsx`

District boundary names are matched to workbook district names with normalized naming rules and fallback token matching. The interface reports the number of funding records successfully matched when the map loads. This provides a quick QA check after deployment.


## Netlify boundary fix

This version includes a `netlify.toml` reverse proxy. The browser requests `/nces/...` from the same Netlify origin, and Netlify forwards that request to the NCES EDGE boundary service. This avoids the browser cross-origin restriction that can prevent the district polygons from loading when the site is hosted on Netlify. Upload the **entire folder**, including `netlify.toml`, when redeploying.
