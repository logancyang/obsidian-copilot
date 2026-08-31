import { getLandingGreetings, pickRandomGreeting } from "@/agentMode/ui/landingGreetings";
import { t } from "@/i18n";

jest.mock("@/i18n", () => ({ t: jest.fn() }));

const ISSUE_URL = "https://github.com/Brevilabs/obsidian-copilot-private/issues/326";
const mockT = t as jest.MockedFunction<typeof t>;

describe("landingGreetings", () => {
  beforeEach(() => {
    mockT.mockReset();
    mockT.mockReturnValue("First greeting|Second greeting");
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getLandingGreetings()", () => {
    it(`keeps one reference until localized copy changes for ${ISSUE_URL}`, () => {
      const first = getLandingGreetings();
      expect(getLandingGreetings()).toBe(first);

      mockT.mockReturnValue("第一条问候|第二条问候");
      expect(getLandingGreetings()).toEqual(["第一条问候", "第二条问候"]);
      expect(getLandingGreetings()).not.toBe(first);
    });
  });

  describe("pickRandomGreeting()", () => {
    it(`selects from the complete localized greeting pool for ${ISSUE_URL}`, () => {
      jest.spyOn(Math, "random").mockReturnValue(0.75);
      expect(pickRandomGreeting()).toBe("Second greeting");
    });
  });
});
