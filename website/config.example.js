// Copy this file to config.js and change the values for your own computer.
// config.js is NOT committed to Git (see .gitignore), because the database address is different on each computer.

const config = {
    db: {
        host: "172.17.0.2",              // IP address of the MySQL container: docker inspect <container name>
        user: "siteproof",
        password: "SiteProofPassword",
        database: "siteproof",
        connectTimeout: 60000
    },
    cookieSecret: "siteproof-secret-ingredient"   // used to sign the login cookie
};

module.exports = config;
