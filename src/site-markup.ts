// Public site markup, rebuilt from the "Ivy Pizza Motion Site" design (design-handoff/source).
export const publicMarkup = `
  <div class="site">
  <header class="site-nav" id="site-nav">
    <div class="site-nav-inner">
      <a class="site-logo" href="#top" aria-label="The Ivy Pizza, back to top">THE IVY <span>PIZZA</span></a>
      <nav class="site-links" aria-label="Primary"><a href="#menu">Menu</a><a href="#experience">Experience</a><a href="#visit">Visit us</a></nav>
      <div class="site-nav-actions">
        <a class="site-nav-menu" href="#menu">Menu</a>
        <button class="account-trigger" id="account-open" type="button">My account</button>
      </div>
    </div>
  </header>
  <main id="top">
    <section class="hero" id="hero" aria-label="Welcome">
      <div class="hero-media" id="hero-media">
        <div class="hero-zoom" id="hero-zoom">
          <picture>
            <source media="(max-width: 759px)" srcset="/ivy-hero-1200.webp" />
            <img src="/ivy-hero.webp" width="1536" height="1024" fetchpriority="high" decoding="async" alt="An Ivy Suya pizza on a wooden board beside an Ivy Pizza box, jollof rice, plantain, suya skewers and salsa" />
          </picture>
        </div>
      </div>
      <div class="hero-overlay" aria-hidden="true"></div>
      <div class="hero-copy" id="hero-copy">
        <p class="eyebrow on-dark" data-intro>Pizza • Burgers • Fast delivery</p>
        <h1>
          <span class="line-mask"><span class="line" data-line>Abuja's new</span></span>
          <span class="line-mask"><span class="line" data-line>pizza <em>ritual.</em></span></span>
        </h1>
        <p class="hero-lead" data-intro>Premium fast food with unmistakable Ivy character: signature pizzas, flame-grilled burgers and a faster way to collect your favourites.</p>
        <div class="hero-ctas" data-intro>
          <a class="pill-btn gold" href="#menu">Explore the menu <span aria-hidden="true">→</span></a>
          <a class="pill-btn ghost-light" href="#visit">Find The Ivy Pizza</a>
        </div>
      </div>
      <div class="hero-chip" id="hero-chip" hidden>
        <div class="hero-chip-text"><span class="hero-chip-name" id="hero-chip-name"></span><span class="hero-chip-price" id="hero-chip-price"></span></div>
        <button type="button" id="hero-chip-add">Add to basket</button>
      </div>
    </section>

    <div class="strip" aria-label="Why The Ivy">
      <div class="strip-track">
        <ul><li>Freshly prepared</li><li>Quick pickup</li><li>Delivery ready</li><li>Made for Abuja</li></ul>
        <ul class="strip-dup" aria-hidden="true"><li>Freshly prepared</li><li>Quick pickup</li><li>Delivery ready</li><li>Made for Abuja</li></ul>
      </div>
    </div>

    <section id="experience" aria-labelledby="exp-title">
      <div class="exp-pinned" id="exp-pinned">
        <div class="exp-stage">
          <div class="exp-photo">
            <div class="exp-a" id="exp-a"><img src="/ivy-dining.webp" width="1400" height="788" loading="lazy" decoding="async" alt="The Ivy Pizza dining room" /></div>
            <div class="exp-b" id="exp-b"><img src="/ivy-pickup.webp" width="1400" height="788" loading="lazy" decoding="async" alt="The Ivy Pizza pickup counter" /></div>
            <div class="exp-caps" aria-hidden="true"><span class="is-on" id="exp-cap-a">Dining room</span><span id="exp-cap-b">Pickup counter</span></div>
          </div>
          <div class="exp-copy">
            <div class="exp-beats">
              <div class="exp-beat" id="exp-t1">
                <p class="eyebrow">The Ivy experience</p>
                <h2 class="exp-title" id="exp-title">Fast food, beautifully done.</h2>
                <p class="lead">The Ivy Pizza brings together a quick-service pizza kitchen, flame-grilled classics and a warm space to dine, collect and go.</p>
              </div>
              <div class="exp-beat" id="exp-t2">
                <p class="eyebrow">Collect and go</p>
                <h2 class="exp-title">Ready when you are.</h2>
                <p class="lead">A dedicated pickup counter keeps collections quick, so your order is waiting the moment you walk in.</p>
              </div>
            </div>
            <div class="exp-progress" aria-hidden="true"><span>01</span><span class="exp-progress-track"><span class="exp-progress-bar" id="exp-bar"></span></span><span>02</span></div>
          </div>
        </div>
      </div>
      <div class="exp-static wrap">
        <p class="eyebrow">The Ivy experience</p>
        <h2 class="exp-title">Fast food, beautifully done.</h2>
        <p class="lead">The Ivy Pizza brings together a quick-service pizza kitchen, flame-grilled classics and a warm space to dine, collect and go.</p>
        <div class="exp-gallery">
          <img src="/ivy-dining.webp" width="1400" height="788" loading="lazy" decoding="async" alt="The Ivy Pizza dining room" />
          <img src="/ivy-pickup.webp" width="1400" height="788" loading="lazy" decoding="async" alt="The Ivy Pizza pickup counter" />
        </div>
      </div>
    </section>

    <section class="menu-section" id="menu" aria-labelledby="menu-title">
      <div class="wrap">
        <div class="menu-head">
          <div data-reveal>
            <p class="eyebrow on-dark">Our menu</p>
            <h2 class="menu-title" id="menu-title">Made to order.<br />Made your way.</h2>
          </div>
          <div class="menu-filters" id="menu-filters" role="group" aria-label="Filter menu by category">
            <span class="menu-filter-ind" id="menu-filter-ind" aria-hidden="true"></span>
            <button class="menu-filter" type="button" data-category="All" aria-pressed="true">All <span class="menu-filter-count"></span></button>
            <button class="menu-filter" type="button" data-category="Pizzas" aria-pressed="false">Pizzas <span class="menu-filter-count"></span></button>
            <button class="menu-filter" type="button" data-category="Burgers" aria-pressed="false">Burgers <span class="menu-filter-count"></span></button>
          </div>
        </div>
        <div class="menu-layout">
          <div class="menu-main">
            <div class="menu-grid" id="menu-items" aria-live="polite" aria-busy="true"></div>
            <p class="menu-note">Prices shown are development samples. Final prices and availability will be confirmed before launch.</p>
          </div>
          <div class="basket-scrim" id="basket-scrim" aria-hidden="true"></div>
          <aside class="basket" id="basket" aria-labelledby="basket-title">
            <span class="basket-grabber" aria-hidden="true"></span>
            <div class="basket-head">
              <div><p class="eyebrow">Your selection</p><h3 id="basket-title">Basket</h3></div>
              <div class="basket-head-right">
                <span class="basket-count" id="basket-count">0 items</span>
                <button class="basket-close" id="basket-close" type="button" aria-label="Close basket">×</button>
              </div>
            </div>
            <div class="basket-body">
              <div class="basket-empty" id="basket-empty"><p>Your basket is empty.</p><p>Pick a pizza or burger to get started.</p></div>
              <ul class="basket-lines" id="basket-lines"></ul>
            </div>
            <div class="basket-foot">
              <div class="basket-total">
                <span class="basket-total-label">Subtotal <span class="basket-updating" id="basket-updating" hidden>Updating…</span></span>
                <strong class="basket-subtotal" id="basket-subtotal">₦0</strong>
              </div>
              <p class="basket-status" id="basket-status" role="status" aria-live="polite"></p>
              <button class="pill-btn gold basket-checkout" id="basket-checkout" type="button" disabled>Continue to checkout</button>
            </div>
          </aside>
        </div>
      </div>
    </section>

    <section class="visit-section" id="visit" aria-labelledby="visit-title">
      <div class="wrap visit-grid">
        <div class="visit-photo" data-reveal>
          <div class="visit-photo-par" id="visit-par"><img src="/ivy-open-kitchen.webp" width="1200" height="675" loading="lazy" decoding="async" alt="The Ivy Pizza open kitchen and counter" /></div>
        </div>
        <div data-reveal>
          <p class="eyebrow">Order your way</p>
          <h2 class="visit-title" id="visit-title">Eat in, pick up or get it delivered.</h2>
          <p class="lead">Our open kitchen, dedicated collection point and delivery-ready setup are designed for your day. Location, opening hours and online ordering will be announced soon.</p>
          <ol class="visit-ways">
            <li><span>01</span><span>Eat in</span></li>
            <li><span>02</span><span>Pick up</span></li>
            <li><span>03</span><span>Delivery</span></li>
          </ol>
          <div class="visit-ctas">
            <a class="pill-btn green" href="mailto:hello@theivypizza.com?subject=The%20Ivy%20Pizza%20enquiry">Contact us <span aria-hidden="true">→</span></a>
            <a class="pill-btn ghost-dark" href="#menu">Browse the menu</a>
          </div>
        </div>
      </div>
    </section>
  </main>
  <footer class="site-footer">
    <div class="site-footer-inner">
      <span class="site-logo">THE IVY <span>PIZZA</span></span>
      <div class="site-footer-meta"><span>Pizza • Burgers • Abuja</span><span>Coming soon</span></div>
    </div>
  </footer>

  <button class="basket-pill" id="basket-pill" type="button" aria-hidden="true" tabindex="-1">
    <span class="basket-pill-text" id="basket-pill-text">Start your order</span>
    <span class="basket-pill-cta" id="basket-pill-cta">Menu →</span>
  </button>

  <dialog class="ivy-dialog" id="account-dialog" aria-labelledby="account-title">
    <div class="ivy-panel">
      <button class="ivy-close" id="account-close" type="button" aria-label="Close account dialog">×</button>
      <p class="eyebrow">The Ivy Pizza</p>
      <h2 id="account-title">Your account</h2>
      <p class="ivy-intro" id="account-intro">Sign in to your Ivy account or create one to get started.</p>
      <div class="ivy-tabs" id="account-tabs" role="tablist" aria-label="Account access" data-mode="signin">
        <button type="button" data-mode="signin" role="tab" aria-selected="true">Sign in</button>
        <button type="button" data-mode="signup" role="tab" aria-selected="false">Create account</button>
        <span class="ivy-tabs-ind" aria-hidden="true"></span>
      </div>
      <form id="auth-form">
        <div class="ivy-expand" id="name-field"><div>
          <label class="ivy-field">Full name<input name="display_name" autocomplete="name" maxlength="100" /></label>
        </div></div>
        <label class="ivy-field">Email address<input name="email" type="email" autocomplete="email" required maxlength="254" /></label>
        <label class="ivy-field">Password<input name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128" /></label>
        <button class="ivy-submit" id="auth-submit" type="submit">Sign in</button>
      </form>
      <div id="profile-card" hidden>
        <div class="profile">
          <span class="profile-initial" id="profile-initial" aria-hidden="true"></span>
          <div style="min-width:0">
            <p class="profile-name" id="profile-name"></p>
            <p class="profile-email" id="profile-email"></p>
            <p class="profile-roles" id="profile-roles"></p>
          </div>
        </div>
        <button class="ivy-submit outline" id="sign-out" type="button">Sign out</button>
      </div>
      <p class="ivy-message" id="auth-message" role="status" aria-live="polite"></p>
      <p class="ivy-config-note" id="auth-config-note" hidden>Account access is being configured. Please try again later.</p>
    </div>
  </dialog>

  <dialog class="ivy-dialog checkout-dialog" id="checkout-dialog" aria-labelledby="checkout-title">
    <div class="ivy-panel">
      <button class="ivy-close" id="checkout-close" type="button" aria-label="Close checkout">×</button>
      <p class="eyebrow">Delivery details</p>
      <h2 id="checkout-title">Checkout</h2>
      <form id="checkout-form">
        <label class="ivy-field" id="saved-address-field" hidden>Use a saved address
          <select id="saved-address-select"><option value="">Enter a new delivery address</option></select>
        </label>
        <label class="ivy-field">Recipient name<input name="recipientName" autocomplete="name" required maxlength="100" /></label>
        <label class="ivy-field">Delivery phone<input name="phone" type="tel" autocomplete="tel" required maxlength="24" /></label>
        <label class="ivy-field">Delivery address<textarea name="address" autocomplete="street-address" required maxlength="500" rows="3"></textarea></label>
        <label class="ivy-field">Landmark <span class="optional">Optional</span><input name="landmark" maxlength="200" /></label>
        <label class="ivy-field">Delivery instructions <span class="optional">Optional</span><textarea name="instructions" maxlength="500" rows="2"></textarea></label>
        <label class="checkout-save"><input name="saveAddress" type="checkbox" /> Save this address to my account</label>
        <label class="ivy-field" id="saved-address-label-field" hidden>Address label<input name="addressLabel" value="Home" maxlength="60" /></label>
        <div class="checkout-breakdown" aria-label="Order total breakdown">
          <div><span>Items</span><strong id="checkout-subtotal">—</strong></div>
          <div><span>Delivery</span><strong id="checkout-delivery">—</strong></div>
          <div><span>Tax</span><strong id="checkout-tax">—</strong></div>
          <div class="checkout-total"><span>Total due later</span><strong id="checkout-total">—</strong></div>
        </div>
        <p class="checkout-note">Development estimate. Payment is not collected in this phase; final delivery and tax settings must be confirmed before launch.</p>
        <p class="ivy-message" id="checkout-message" role="status" aria-live="polite"></p>
        <button class="ivy-submit" id="checkout-submit" type="submit">Place order</button>
      </form>
      <section class="checkout-success" id="checkout-success" hidden>
        <div class="checkout-success-mark" aria-hidden="true">✓</div>
        <h3>Order received</h3>
        <p>Your order number is <strong id="checkout-order-number"></strong>.</p>
        <p id="checkout-order-status">Payment is pending. No payment has been collected.</p>
        <button class="ivy-submit" id="checkout-done" type="button">Done</button>
      </section>
    </div>
  </dialog>
  </div>
`;
