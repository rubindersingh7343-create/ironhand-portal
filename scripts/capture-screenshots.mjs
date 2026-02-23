import { chromium, devices } from "playwright";

const baseURL = "http://localhost:3000";
const customDevices = {
  "iPad Pro 12.9": {
    viewport: { width: 1024, height: 1366 }, // yields 2048x2732 @2x
    userAgent:
      "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1",
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    defaultBrowserType: "chromium",
  },
};

const scenarios = [
  {
    name: "iphone-6.7-ironhand.png",
    device: "iPhone 14 Pro Max", // 1290x2796
    viewport: { width: 430, height: 932 },
    loginPath: "/auth/login",
    email: "rsingh1199@icloud.com",
    password: "Liquor@Laguna9632",
    targetPath: "/",
    scrollY: 200,
    pauseMs: 1200,
  },
  {
    name: "iphone-6.5-client-records.png",
    device: "iPhone 11 Pro Max", // 1242x2688
    viewport: { width: 414, height: 896 },
    loginPath: "/auth/login",
    email: "11rsingh99@gmail.com",
    password: "Liquor@Laguna9632",
    targetPath: "/",
    scrollY: 320,
    pauseMs: 1200,
  },
  {
    name: "iphone-6.1-employee-upload.png",
    device: "iPhone 12", // 1170x2532
    viewport: { width: 390, height: 844 },
    loginPath: "/auth/login",
    email: "11rsingh99999@gmail.com",
    password: "Liquor@Laguna9632",
    targetPath: "/",
    scrollY: 120,
    pauseMs: 800,
  },
  {
    name: "ipad-13-master-dashboard.png",
    device: "iPad Pro 12.9", // 2048x2732
    viewport: { width: 1024, height: 1366 },
    loginPath: "/master",
    email: "rubinder.singh7343@yahoo.com",
    password: "Liquor@Laguna9632",
    targetPath: "/master",
    scrollY: 140,
    pauseMs: 1200,
  },
  {
    name: "ipad-13-records.png",
    device: "iPad Pro 12.9",
    viewport: { width: 1024, height: 1366 },
    loginPath: "/auth/login",
    email: "11rsingh99@gmail.com", // client role
    password: "Liquor@Laguna9632",
    targetPath: "/",
    scrollY: 180,
    pauseMs: 1200,
  },
];

async function login(page, { email, password }) {
  await page.fill('input[type="email"]', email);
  await page.fill('input[type="password"]', password);
  await Promise.all([
    page.waitForURL("**/*", { waitUntil: "networkidle" }),
    page.click('button[type="submit"]'),
  ]);
}

async function captureScenario(browser, scenario) {
  const device = devices[scenario.device] ?? customDevices[scenario.device];
  if (!device) {
    throw new Error(`Playwright device not found: ${scenario.device}`);
  }

  const context = await browser.newContext(
    scenario.viewport
      ? { ...device, viewport: scenario.viewport, baseURL }
      : { ...device, baseURL },
  );

  const page = await context.newPage();

  await page.goto(scenario.loginPath, { waitUntil: "networkidle" });
  await login(page, scenario);

  // Ensure we land on the target page for the screenshot.
  await page.goto(scenario.targetPath, { waitUntil: "networkidle" });
  await page.waitForTimeout(scenario.pauseMs ?? 1000);

  if (scenario.scrollY) {
    await page.evaluate((y) => window.scrollTo(0, y), scenario.scrollY);
    await page.waitForTimeout(400);
  }

  await page.screenshot({
    path: `screenshots/${scenario.name}`,
    fullPage: false,
  });

  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const scenario of scenarios) {
      console.log(`Capturing ${scenario.name} ...`);
      await captureScenario(browser, scenario);
    }
    console.log("Done. Screenshots saved in ./screenshots");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
