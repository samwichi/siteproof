// Run several statements as one transaction: either all of them are saved or none (for example the inspection AND the new status
// of the delivery). fn gets its own connection of the pool; when fn throws, everything is rolled back and the error goes on.
async function inTransaction(pool, fn) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const result = await fn(conn);
        await conn.commit();
        return result;
    }
    catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
    }
    finally {
        conn.release();
    }
}

module.exports = { inTransaction };
