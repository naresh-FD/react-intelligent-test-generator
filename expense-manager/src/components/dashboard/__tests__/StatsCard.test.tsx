/** @generated AUTO-GENERATED FILE - safe to overwrite */
import * as React from "react";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../../../test-utils/renderWithProviders";
import { StatsCard } from "../StatsCard";


describe("StatsCard", () => {
  type Props = React.ComponentProps<typeof StatsCard>;
  const defaultProps: Props = {
  title: undefined,
  value: undefined,
  change: undefined,
  icon: undefined
  };

  const renderUI = (props: Partial<Props> = {}) =>
    renderWithProviders(<StatsCard {...defaultProps} {...props} />);

  describe("Rendering", () => {
    it("should render without crashing", () => {
      renderUI();
    });

    it("should render with default props", () => {
      const { container } = renderUI();
      expect(container).toBeInTheDocument();
    });
  });

  describe("Props", () => {
    it("should accept and render custom props", () => {
      renderUI(({
  title: undefined,
  value: undefined
}));
    });
  });

  describe("Snapshot", () => {
    it("should match snapshot", () => {
      const { container } = renderUI();
      expect(container.firstChild).toMatchSnapshot();
    });
  });
});
