// The material picker (category buttons + search box + <select>), shared by the new delivery form (routes/deliveries.js)
// and the new product form of a supplier (routes/products.js).
// The materials that match the text and the category (457 materials are too many for a normal <select>, so only the first 100 are sent).
// The category buttons show how many materials of each category match the text, so the user sees where to look.
// db = the promise version of the connection pool. excludeOrgId (optional): leave out the materials that this supplier offers already.
const { like } = require('./listing');

const MATERIAL_LIMIT = 100;

async function findMaterials(db, text, categoryId, excludeOrgId) {
    const q = String(text || '').trim().slice(0, 100);
    const category = Number.isInteger(Number(categoryId)) ? Number(categoryId) : 0;      // 0 = all categories
    const textSql = (q ? ' AND m.material_name LIKE ?' : '')
                  + (excludeOrgId ? ' AND m.material_id NOT IN (SELECT sp.material_id FROM supplier_product sp WHERE sp.org_id = ?)' : '');
    const textArgs = (q ? [like(q)] : []).concat(excludeOrgId ? [excludeOrgId] : []);

    const [counts] = await db.execute(
        `SELECT c.category_id AS id, c.category_name AS name, COUNT(m.material_id) AS n
         FROM material_category c LEFT JOIN material m ON m.category_id = c.category_id${textSql}
         GROUP BY c.category_id, c.category_name ORDER BY c.category_id`, textArgs);
    const categories = counts.map(c => ({ id: c.id, name: c.name, n: Number(c.n), active: c.id === category }));
    const all = categories.reduce((sum, c) => sum + c.n, 0);
    const total = category ? (categories.find(c => c.id === category) || { n: 0 }).n : all;

    const categorySql = category ? ' AND m.category_id = ?' : '';
    const [materials] = await db.execute(
        `SELECT m.material_id, m.material_name, m.unit, c.category_name
         FROM material m JOIN material_category c ON c.category_id = m.category_id
         WHERE 1 = 1${textSql}${categorySql}
         ORDER BY c.category_id, m.material_name LIMIT ${MATERIAL_LIMIT}`, textArgs.concat(category ? [category] : []));

    // Group the materials by category, so the <select> can show <optgroup>s.
    const groups = [];
    for (const m of materials) {
        let g = groups[groups.length - 1];
        if (!g || g.category !== m.category_name) {
            g = { category: m.category_name, items: [] };
            groups.push(g);
        }
        g.items.push(m);
    }
    return { groups: groups, categories: categories, category: category || '', allActive: !category, all: all,
             materialTotal: total, materialShown: materials.length, materialMore: total > materials.length };
}

module.exports = { findMaterials };
