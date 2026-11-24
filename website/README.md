# SiteProof website

Express 5 + express-handlebars + mysql2 + HTMX 4 + Bootstrap 5 (the technology of the laboratories).
Extra packages: `cookie-parser` (signed login cookie, as in the Express laboratory), `bcryptjs` (the passwords in `user_account` are bcrypt hashes) and `multer` (the proof documents of a company registration are uploaded files).

## 1. Run it

1. Start MySQL and run the scripts `database/01_schema.sql` to `database/06_sample_data.sql` (in this order). **If you already have the database from an older version, run all the scripts again** (`01_schema.sql` deletes the old database): the registration needs new tables and columns. If you want to keep your data, `database/07_upgrade_user_approval.sql` adds only the new column and rule of the user approval and the projects.
2. Create the database user of the website (change the IP range if your Docker network is different):

   ```sql
   CREATE USER 'siteproof'@'172.17.%' IDENTIFIED BY 'SiteProofPassword';
   GRANT ALL ON siteproof.* TO 'siteproof'@'172.17.%';
   ```

3. Start a Node.js container with this folder, as in the HTMX laboratory, and run the website:

   ```
   docker run -it --name SiteProof -p 8080:80 -v .\website:/app node bash
   cd /app
   npm install
   npm i -g nodemon
   cp config.example.js config.js        # then change the database IP in config.js
   nodemon -L app.js
   ```

4. Open http://localhost:8080

`config.js` is not committed (it is in `.gitignore`): the database IP is different on each computer. Commit changes of `config.example.js` instead.

## 2. Demo accounts (password of all: `siteproof123`)

| Role | E-mail |
|---|---|
| Contractor project manager | `pm.lin@siteproof.example.com` (Formosa Build, 2 projects) |
| Contractor project manager | `pm.chen@siteproof.example.com` (Pacific Civil Works, 1 project) |
| Inspector | `inspector.wang@siteproof.example.com`, `inspector.huang@siteproof.example.com` |
| Supplier | `supplier.central@siteproof.example.com`, `supplier.superior@siteproof.example.com`, `supplier.cornerstone@siteproof.example.com`, `supplier.united@siteproof.example.com` |
| Inspector of a third-party inspection company | `inspector.lee@siteproof.example.com` (Taiwan Site Inspection; appointed by Formosa Build, so he sees the deliveries of Formosa) |
| Company account (manages the users of the company) | `company.formosa@siteproof.example.com`, `company.pacific@siteproof.example.com`, `company.tsi@siteproof.example.com` (inspection company), `company.central@siteproof.example.com` (supplier) |
| **Website administrator** | `admin@siteproof.example.com` - password **`SiteProofAdmin#2026`** (not `siteproof123`) |

The administrator of the sample data is only for the demo: before a real use create your own with `node scripts/create-admin.js <e-mail> "<full name>" <password>` and delete the demo one.

## 2.1 Registration (anybody can open it from the menu: Register)

There are two kinds of accounts:

| | Company account | User account |
|---|---|---|
| Who | A contractor, a supplier or a third-party inspection company that is new on SiteProof | A contractor project manager, a supplier or an inspector |
| How | Choose the type, enter the name and contact data (the server gives the company a random 8-digit company ID and shows it after the registration), optionally up to 3 proof documents (PDF, JPG, PNG, 5 MB each), and the e-mail and password of the company account | Choose the role, search the company in the list (name or ID), enter name, e-mail and password |
| Can sign in | Only after the **administrator approves** the company | Only after the **company account of the company approves** the user |
| Can do | See and manage **all users of its company** (approve or reject a new registration, switch an account off or on); a contractor also creates the **projects** and appoints third-party inspection companies | The work of its role (deliveries, inspections, ...) |

Rules:

* The list of the user registration has only **approved** companies **with a company account**, and only the companies that fit the role (a contractor works for a contractor, a supplier for a supplier, an inspector for a contractor or for an inspection company). The server checks it again, so a changed form does not help. The 500 suppliers of the given data have no company account, so their people register the company first.
* A new user is **waiting** (`user_account.status = 'PENDING'`) until the company account approves or rejects the registration (menu: Users of my company; the waiting ones are first and the menu shows how many wait). Before, anybody could choose a company in the list and work for it at once (for example inspect and reject its deliveries). A waiting or rejected user cannot sign in, and the login page says why. A rejected registration can still be approved later; an approved user is switched off instead of rejected.
* The company account of a contractor manages the **projects** (menu: Projects): name and retention rate in percent. The name is unique in the company. A project can be deleted only while it has no delivery. A new retention rate is used for the next inspections; the recorded inspections keep the rate that they copied. Without a project the project managers cannot create a delivery, so a new contractor creates its first project here.
* A company that is not approved (waiting or rejected) cannot be used: nobody of it can sign in, and a user that has the page open is sent to the login page at the next click. The login page says why (a rejection shows the reason that the administrator wrote). The same happens to a user that the company account switched off.
* The administrator sees all companies (waiting ones first) and all users, opens the proof documents, approves or rejects a company (a rejected or approved company can be changed later). The administrator does not see any delivery.
* The company list of the administrator shows the ID, name, type, phone, e-mail, address, status, users, documents and the registration date. Filters: status, type and "accounts". The normal view ("With an account") shows the companies that somebody registered for and the waiting ones; the 500 companies of the given data have no account, so they are hidden until the filter is "All companies" (a hint says how many). The filter "Same name as another" and the yellow mark "N more with this name" show companies with the same name: in the given data they are different companies (other ID, phone and address), so they are never merged. On the page of a company the administrator sees a warning with the other companies of the same name before approving.
* A contractor appoints a third-party inspection company (menu: Inspection companies). The inspectors of that company then see and inspect the deliveries of all projects of the contractor; removing the appointment stops it at once. Inspectors who registered for the contractor itself do not need an appointment.
* The proof documents are saved in `website/uploads/` under a random name (the folder is in `.gitignore`). The server checks the first bytes of each file (a text file named `.pdf` is refused) and only the administrator can open a document.
* The company ID is not typed by the user: the server draws a random 8-digit number and draws again if the number exists already (also the 500 suppliers of the given data), so two companies never get the same ID.

## 3. Folders

```
website/
├── app.js                 starts the server: template engine, middleware, database pool, wildcard route, routers
├── config.example.js      database and cookie settings (copy to config.js)
├── routes/
│   ├── auth.js            UC1  sign in / sign out (and the message when the account is switched off or the company is not approved)
│   ├── register.js        registration: company account (with proof documents) and user account (company list with search)
│   ├── company.js         company account: users of the company (approve / reject a registration, switch off / on) and the appointment of inspection companies
│   ├── projects.js        company account of a contractor: create, list, edit, delete the projects (name, retention rate)
│   ├── admin.js           administrator: all companies, approve / reject, proof documents and users of a company
│   ├── adminUsers.js      administrator: all users with their company
│   ├── adminDocuments.js  administrator: opens a proof document (a normal link, mounted before the wildcard route)
│   ├── deliveries.js      UC2, UC3  contractor: create, list, edit, delete delivery records, and the detail page of one delivery   <-- first CRUD
│   ├── inspections.js     UC8-UC10  inspector: see the supplier's quality documents, record received / accepted quantity (accepted value and retention are calculated)
│   ├── ratings.js         UC4  contractor: complete an inspected delivery and rate the supplier (1-5)
│   ├── assigned.js        UC5  supplier: list the assigned deliveries and move each one forward (PREPARING, IN_TRANSIT, DELIVERED)
│   ├── history.js         UC7  supplier: own average rating, score distribution and delivery history (read only)
│   └── documents.js       UC6  supplier: add, list, edit, delete quality documents (type and file name) until the delivery is inspected
├── lib/
│   ├── auth.js            loadUser (who is logged in; asks the database at every request whether the account and its company are still allowed), requireRole('...'), role names, start page of each role
│   ├── upload.js          proof documents: receive (multer), check the first bytes, save under a random name, read
│   ├── respond.js         fail(res, message): error message in the toast, without changing the page
│   └── listing.js         readList(): search, status filter, sorting and paging of a list (used by all the list pages)
├── views/
│   ├── index.hbs          the only full page: header, navbar, div#toast, main#main, footer
│   ├── navbar.hbs, home.hbs, login.hbs, toast.hbs
│   ├── list/              the parts that every list shares: controls.hbs (search box and status filter), th.hbs (sortable column header), pager.hbs
│   └── deliveries/, inspections/, ratings/, assigned/, history/, documents/, register/, company/, admin/     one folder for each route (index, row, rowToast, new/form, edit)
├── scripts/create-admin.js   creates a website administrator in the database
├── uploads/               the proof documents of the companies (not in Git)
└── public/                our own CSS / JS / images
```

## 4. How to add the next function (the 3 steps of the laboratory)

1. **Front-end:** put an element with an HTMX attribute (`hx-get`, `hx-post`, `hx-put`, `hx-delete`) in a template in `views/<feature>/`.
2. **Back-end:** create `routes/<feature>.js`, mount it in `app.js` with `requireRole('<ROLE>')`, and add the link in `views/navbar.hbs`.
3. **Response:** render a small template (a `<tr>`, a form, or `toast`) that HTMX puts in the target.

Rules used in `routes/deliveries.js` (copy them in the other routes):

* every query is limited to the company of the logged-in user (`req.user.orgId`), so a user cannot read or change the data of another company by changing the id in the URL;
* an action that the business rules do not allow is checked in SQL (`AND d.status = 'SCHEDULED'`) and answered with `fail(res, 'message', status)`;
* a delete button that answers only with a message uses `hx-swap="delete"`: HTMX 4 does not swap an empty response that comes with a `<hx-partial>`, so with `outerHTML` the row would stay on the screen.

### How a list page works (search, filter, sort, paging)

Each list route defines a small `LIST` object (the columns to search, the allowed statuses, the sortable columns) and calls `readList(...)` from `lib/listing.js`. The user can only choose one of the listed sort keys, so no text of the user reaches the SQL.
In the template, the search form, the column headers and the pager are the shared partials in `views/list/`. They ask for the same page with `?q=&status=&sort=&dir=&page=`; HTMX takes only `<div id="list">` out of the answer (`hx-select`) and updates the address (`hx-push-url`), so reload, back button and links work. The search box is outside `#list`, so the cursor stays in it while the list changes.
To add the same to a new list: copy `LIST` and the `index.hbs` structure of `routes/inspections.js`.

## 5. Git

Each member works in his own branch (for example `feature/delivery-crud`). After each finished function: `git add`, `git commit -m "Add ..."`, `git push`, and a pull request to `main`.

## Accessibility and keyboard use

- Every page has one `<h1>` (the page title); tables have a hidden `<caption>` and `scope="col"` headers; sortable headers use `aria-sort`; the pager marks the current page with `aria-current`.
- Row actions (edit, delete, inspect, ...) are real `<button>` elements with a name such as "Delete delivery #8", so Tab, Enter and Space work. Icons are hidden from screen readers (`aria-hidden`).
- Every form field has a `<label for>`; ids in inline forms contain the row number (`quantity-8`) so they stay unique. The first field of an inline form has `autofocus`.
- The first Tab on every page shows a "Skip to the main content" link.
- `public/a11y.js` moves the focus after HTMX changes the page (HTMX does not do it like a normal page load): to the page title after a menu click, back to the same row after a form is saved or cancelled, to the same column header after sorting, to the list after a page number click. A hidden `role="status"` message tells screen readers how many results a list has after a search.
- `public/site.css`: darker star colour (contrast), clear focus frame.
- Check: axe-core (WCAG 2.x A/AA rules) on all pages of the three roles, including the open inline forms: 0 violations.
