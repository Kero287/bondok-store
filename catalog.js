function getProductsWithSales(database) {
    return database.prepare(`
        SELECT p.id, p.name, p.price, p.stock, p.category, p.brand, p.image, p.sizes_json, p.colors_json, p.description, p.best_seller,
               COALESCE(s.unitsSold, 0) AS unitsSold
        FROM products p
        LEFT JOIN (
            SELECT json_extract(item.value, '$.id') AS productId,
                   SUM(CAST(json_extract(item.value, '$.quantity') AS INTEGER)) AS unitsSold
            FROM orders o, json_each(o.items_json) item
            WHERE o.status IN ('Confirmed', 'Delivered')
            GROUP BY productId
        ) s ON s.productId = p.id
        ORDER BY p.id
    `).all();
}

module.exports = { getProductsWithSales };
