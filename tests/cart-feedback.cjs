const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '../script.js'), 'utf8');
function element() {
    const classes = new Set();
    return {
        textContent: '', dataset: {},
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        setAttribute() {}, removeAttribute() {}, closest() { return null; },
        append(child) { child.parentElement = this; },
        getAnimations() { return []; }, animate() {},
    };
}
const body = element();
const count = element();
const toast = element();
const timers = new Map();
let timerId = 0;
let click;
let saved;
const cart = [];
const context = {
    products: [{ id: 1, name: 'Test hoodie', stock: 5 }], cart,
    currentUser: null, cartCount: count,
    window: { matchMedia: () => ({ matches: false }) },
    document: { body, createElement: () => toast, addEventListener: (name, handler) => { click = handler; } },
    setTimeout: fn => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: id => timers.delete(id),
    saveCart: () => { saved = JSON.stringify(cart); },
    renderCart: () => { count.textContent = String(cart.reduce((n, item) => n + item.quantity, 0)); },
};
vm.createContext(context);
vm.runInContext(source.slice(source.indexOf('const addButtonTimers ='), source.indexOf('async function api(')), context);
vm.runInContext(source.slice(source.indexOf('document.addEventListener("click"'), source.indexOf('document.querySelector("#product-form")?.addEventListener')), context);
const add = element();
add.dataset.addProduct = '1';
function press(selector, button) {
    click({ target: { closest: query => query === selector ? button : null } });
}
add.textContent = 'Add to cart';
press('[data-add-product]', add);
assert.equal(cart[0].quantity, 1);
assert.equal(JSON.parse(saved)[0].quantity, 1);
assert.equal(add.textContent, 'Add to cart');
assert.ok(add.classList.contains('is-loading'));
assert.ok(!add.classList.contains('is-added'));
assert.equal(toast.textContent, '');
press('[data-add-product]', add);
assert.equal(cart[0].quantity, 1, 'Ignore duplicate clicks while spinning');
assert.equal(timers.size, 1);
for (const callback of [...timers.values()]) callback();
assert.ok(!add.classList.contains('is-loading'));
press('[data-add-product]', add);
assert.equal(cart[0].quantity, 2, 'Allow another addition after the spinner finishes');
for (const callback of [...timers.values()]) callback();
const remove = element();
remove.dataset.removeProduct = '1';
press('[data-remove-product]', remove);
assert.equal(cart.length, 0);
add.disabled = true;
press('[data-add-product]', add);
assert.equal(cart.length, 0);
console.log('Passed: spinner, unchanged label, duplicate-click guard, reset, removal, and disabled button.');