-- Remove drink variants requested by the menu update.
DELETE FROM menu_items
WHERE slug IN ('schweppes-pineapple', 'schweppes-virgin-mojito', 'schweppes-chapman');
