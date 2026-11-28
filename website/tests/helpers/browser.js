// A very small "browser" for the route tests: it keeps the cookies of one user (the login cookie, and the short note
// of a rejected company) and sends forms with fetch.
// HTMX sends the forms as normal form data (and PUT / DELETE with the same body), so the tests do the same.
// Every request has the header HX-Request like the requests of HTMX: without it, app.js answers a GET with the empty
// page shell (index.hbs), which then asks for the content with HTMX.
class Browser {
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
        this.cookies = {};
    }

    get cookie() {
        return Object.entries(this.cookies).map(([name, value]) => name + '=' + value).join('; ');
    }

    // Keep each cookie that the website sets; a cookie that it clears (empty value or an expiry in the past) is forgotten.
    keep(setCookies) {
        for (const line of setCookies) {
            const [pair, ...attributes] = line.split(';');
            const at = pair.indexOf('=');
            const name = pair.slice(0, at).trim(), value = pair.slice(at + 1).trim();
            const expired = attributes.some(a => /^\s*expires=/i.test(a) && new Date(a.split('=')[1]) < new Date())
                         || attributes.some(a => /^\s*max-age=0\s*$/i.test(a));
            if (value === '' || expired) delete this.cookies[name];
            else this.cookies[name] = value;
        }
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
        this.keep(res.headers.getSetCookie());
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
