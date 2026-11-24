# SiteProof website

Express 5 + express-handlebars + mysql2 + HTMX 4 + Bootstrap 5 (the technology of the laboratories).
Extra packages: `cookie-parser` (signed login cookie, as in the Express laboratory) and `bcryptjs` (the passwords in `user_account` are bcrypt hashes).

## 1. Run it

1. Start MySQL and run the scripts `database/01_schema.sql` to `database/06_sample_data.sql` (in this order).
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

## 3. Folders

```
website/
├── app.js                 starts the server: template engine, middleware, database pool, wildcard route, routers
├── config.example.js      database and cookie settings (copy to config.js)
├── routes/
│   ├── auth.js            UC1  sign in / sign out
│   ├── deliveries.js      UC2, UC3  contractor: create, list, edit, delete delivery records   <-- first CRUD
│   ├── inspections.js     UC8-UC10  inspector: record received / accepted quantity (accepted value and retention are calculated)
│   ├── ratings.js         UC4  contractor: complete an inspected delivery and rate the supplier (1-5)
│   ├── assigned.js        UC5  supplier: list the assigned deliveries and move each one forward (PREPARING, IN_TRANSIT, DELIVERED)
│   ├── history.js         UC7  supplier: own average rating, score distribution and delivery history (read only)
│   └── documents.js       UC6  supplier: add, list, edit, delete quality documents (type and file name) until the delivery is inspected
├── lib/
│   ├── auth.js            loadUser (who is logged in) and requireRole('...')
│   └── respond.js         fail(res, message): error message in the toast, without changing the page
├── views/
│   ├── index.hbs          the only full page: header, navbar, div#toast, main#main, footer
│   ├── navbar.hbs, home.hbs, login.hbs, toast.hbs
│   └── deliveries/, inspections/, ratings/, assigned/, history/, documents/     one folder for each route (index, row, rowToast, new/form, edit)
└── public/                our own CSS / JS / images
```

## 4. How to add the next function (the 3 steps of the laboratory)

1. **Front-end:** put an element with an HTMX attribute (`hx-get`, `hx-post`, `hx-put`, `hx-delete`) in a template in `views/<feature>/`.
2. **Back-end:** create `routes/<feature>.js`, mount it in `app.js` with `requireRole('<ROLE>')`, and add the link in `views/navbar.hbs`.
3. **Response:** render a small template (a `<tr>`, a form, or `toast`) that HTMX puts in the target.

Rules used in `routes/deliveries.js` (copy them in the other routes):

* every query is limited to the company of the logged-in user (`req.user.orgId`), so a user cannot read or change the data of another company by changing the id in the URL;
* an action that the business rules do not allow is checked in SQL (`AND d.status = 'SCHEDULED'`) and answered with `fail(res, 'message', status)`.

## 5. Git

Each member works in his own branch (for example `feature/delivery-crud`). After each finished function: `git add`, `git commit -m "Add ..."`, `git push`, and a pull request to `main`.
