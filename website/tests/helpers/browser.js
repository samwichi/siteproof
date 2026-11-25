// A very small "browser" for the route tests: it keeps the login cookie of one user and sends forms with fetch.
// HTMX sends the forms as normal form data (and PUT / DELETE with the same body), so the tests do the same.
// Every request has the header HX-Request like the requests of HTMX: without it, app.js answers a GET with the empty
// page shell (index.hbs), which then asks for the content with HTMX.
class Browser {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.cookie = '';
    }

    async request(method, url, form) {
        const options = { method: method, redirect: 'manual', headers: { Cookie: this.cookie, 'HX-Request': 'true' } };
        if (form instanceof FormData) {
            options.body = form;                                  // multipart (file upload)
        }
        else if (form) {
            options.body = new URLSearchParams(form);
        }
        const res = await fetch(this.baseUrl + url, options);
        const set = res.headers.getSetCookie().find(c => c.startsWith('user='));
        if (set) this.cookie = set.split(';')[0];
        return { status: res.status, location: res.headers.get('location'), hxRedirect: res.headers.get('hx-redirect'), body: await res.text() };
    }

    get(url) { return this.request('GET', url); }
    post(url, form) { return this.request('POST', url, form); }
    put(url, form) { return this.request('PUT', url, form); }

    async login(email, password) {
        const res = await this.post('/login', { email: email, password: password });
        return res.location;
    }
}

module.exports = { Browser };
