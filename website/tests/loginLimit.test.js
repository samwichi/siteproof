// Unit tests of lib/loginLimit.js (the limit for wrong passwords).
// State-transition testing with a mocked clock (testing laboratory, section 8): instead of waiting 15 minutes,
// the test moves Date.now() forward with mock.timers.
const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { lockedMinutes, recordFailure, recordSuccess } = require('../lib/loginLimit');

const MINUTE = 60 * 1000;
let n = 0;
// Every test uses its own e-mail and IP address, because the counters are kept in memory for the whole file.
const fresh = () => { n += 1; return { email: 'user' + n + '@test.example.com', ip: '10.0.0.' + n }; };

beforeEach(() => mock.timers.enable({ apis: ['Date'], now: new Date('2026-12-09T09:00:00+08:00') }));
afterEach(() => mock.timers.reset());

test('4 wrong passwords do not lock the e-mail, the 5th one locks it for 15 minutes', () => {
    const { email, ip } = fresh();
    for (let i = 0; i < 4; i++) recordFailure(email, ip);
    assert.equal(lockedMinutes(email, ip), 0);
    recordFailure(email, ip);
    assert.equal(lockedMinutes(email, ip), 15);
});

test('the lock ends after 15 minutes', () => {
    const { email, ip } = fresh();
    for (let i = 0; i < 5; i++) recordFailure(email, ip);
    mock.timers.tick(14 * MINUTE);
    assert.equal(lockedMinutes(email, ip), 1);
    mock.timers.tick(MINUTE);
    assert.equal(lockedMinutes(email, ip), 0);
});

test('the e-mail is compared without upper and lower case', () => {
    const { email, ip } = fresh();
    for (let i = 0; i < 5; i++) recordFailure(email.toUpperCase(), ip);
    assert.equal(lockedMinutes(email, ip), 15);
});

test('a correct password resets the counter of the e-mail', () => {
    const { email, ip } = fresh();
    for (let i = 0; i < 4; i++) recordFailure(email, ip);
    recordSuccess(email);
    recordFailure(email, ip);
    assert.equal(lockedMinutes(email, ip), 0, 'only 1 wrong password after the success');
});

test('wrong passwords older than 15 minutes are forgotten', () => {
    const { email, ip } = fresh();
    for (let i = 0; i < 4; i++) recordFailure(email, ip);
    mock.timers.tick(16 * MINUTE);
    recordFailure(email, ip);
    assert.equal(lockedMinutes(email, ip), 0);
});

test('100 wrong passwords from the same IP address lock that address, also for other e-mails', () => {
    const { ip } = fresh();
    for (let i = 0; i < 99; i++) recordFailure('someone' + i + '@test.example.com', ip);
    assert.equal(lockedMinutes('another@test.example.com', ip), 0);
    recordFailure('last@test.example.com', ip);
    assert.equal(lockedMinutes('another@test.example.com', ip), 15);
    assert.equal(lockedMinutes('another@test.example.com', '10.9.9.9'), 0, 'another address is not locked');
});
