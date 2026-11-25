// Copy this file to config.js and change the values for your own computer.
// config.js is NOT committed to Git (see .gitignore), because the database address and the cookie secret are different on each computer.

const config = {
    db: {
        host: "172.17.0.2",              // IP address of the MySQL container: docker inspect <container name>
        user: "siteproof",
        password: "SiteProofPassword",
        database: "siteproof",
        connectTimeout: 60000
    },
    // The secret that signs the login cookie: a long random text that only your computer knows (at least 32 characters).
    // Leave it empty and the website makes a random one in website/.cookie-secret at the first start (see lib/secret.js).
    // Never use a value that is on GitHub: whoever knows it can sign in as any user, also as the administrator.
    cookieSecret: ""
};

module.exports = config;
