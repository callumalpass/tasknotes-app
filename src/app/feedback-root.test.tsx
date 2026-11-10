import { FeedbackButton } from "@mdbase-dev/ui/feedback";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { feedbackConfiguration, FeedbackRoot } from "./feedback-root";

const none = {
  environment: undefined,
  endpoint: undefined,
  turnstileSiteKey: undefined,
  nativeIos: false,
};

describe("feedback configuration", () => {
  it("uses the managed staging Worker and its widget on staging", () => {
    expect(feedbackConfiguration({ ...none, environment: "staging" })).toEqual({
      endpoint: "https://feedback-api-staging.mdbase.dev/v1/feedback",
      turnstileSiteKey: "0x4AAAAAAEbkvA4d9vQJq2D1",
    });
  });

  it("uses the managed production Worker and its widget on production", () => {
    expect(
      feedbackConfiguration({ ...none, environment: "production" }),
    ).toEqual({
      endpoint: "https://feedback-api.mdbase.dev/v1/feedback",
      turnstileSiteKey: "0x4AAAAAAEboz_mLT-taI3H-",
    });
  });

  it.each(["lab", undefined])(
    "stays hidden on %s until its origin is approved",
    (environment) => {
      expect(feedbackConfiguration({ ...none, environment })).toEqual({
        endpoint: null,
        turnstileSiteKey: null,
      });
    },
  );

  it("lets an explicit build endpoint win, with its own widget key", () => {
    expect(
      feedbackConfiguration({
        ...none,
        environment: "lab",
        endpoint: "http://127.0.0.1:8790/v1/feedback",
        turnstileSiteKey: " test-key ",
      }),
    ).toEqual({
      endpoint: "http://127.0.0.1:8790/v1/feedback",
      turnstileSiteKey: "test-key",
    });
  });

  it("ignores an endpoint that is not HTTPS or loopback", () => {
    expect(
      feedbackConfiguration({
        ...none,
        endpoint: "http://feedback.example/v1/feedback",
      }).endpoint,
    ).toBeNull();
  });

  it("stays hidden in the iOS shell, whose origin the Worker rejects", () => {
    expect(
      feedbackConfiguration({
        ...none,
        environment: "staging",
        endpoint: "https://feedback-api-staging.mdbase.dev/v1/feedback",
        nativeIos: true,
      }).endpoint,
    ).toBeNull();
  });
});

describe("FeedbackRoot", () => {
  it("renders no entry point when feedback is not configured", () => {
    render(
      <FeedbackRoot>
        <p>workspace</p>
        <FeedbackButton />
      </FeedbackRoot>,
    );
    expect(screen.getByText("workspace")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
