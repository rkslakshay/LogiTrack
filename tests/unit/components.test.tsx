// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DataTable, FilterSelect, Pagination, SearchInput, type Column } from "@/components/app/data-table";
import { FormField } from "@/components/app/form-dialog";
import { EmptyState, ErrorState, StatCard } from "@/components/app/page";
import { StatusBadge, toneFor } from "@/components/app/status-badge";

afterEach(cleanup);

interface Row {
  id: string;
  name: string;
  km: number;
}
const rows: Row[] = [
  { id: "1", name: "MH 12 AB 1234", km: 1200 },
  { id: "2", name: "KA 01 CD 5678", km: 800 },
];
const columns: Column<Row>[] = [
  { key: "name", header: "Vehicle", sortKey: "name", render: (r) => r.name },
  { key: "km", header: "Odometer", sortKey: "km", align: "right", render: (r) => `${r.km} km` },
  { key: "plain", header: "Notes", render: () => "—" },
];

describe("StatusBadge", () => {
  it("renders a human-readable label", () => {
    render(<StatusBadge status="ON_DELIVERY" />);
    expect(screen.getByText("On Delivery")).toBeTruthy();
  });

  it("uses consistent tones for the same meaning across entities", () => {
    expect(toneFor("AVAILABLE")).toBe("success");
    expect(toneFor("DELIVERED")).toBe("success");
    expect(toneFor("FAILED")).toBe("danger");
    expect(toneFor("OVERDUE")).toBe("danger");
    expect(toneFor("DELAYED")).toBe("warning");
    expect(toneFor("MAINTENANCE")).toBe("warning");
    expect(toneFor("SOMETHING_NEW")).toBe("neutral");
  });

  it("accepts a custom label", () => {
    render(<StatusBadge status="DELAYED" label="Late" />);
    expect(screen.getByText("Late")).toBeTruthy();
  });
});

describe("DataTable", () => {
  it("renders headers and one row per record", () => {
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} caption="Vehicles" />);
    const table = screen.getByRole("table", { name: "Vehicles" });
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(screen.getByText("MH 12 AB 1234")).toBeTruthy();
    expect(screen.getByText("800 km")).toBeTruthy();
  });

  it("only makes columns with a sort key sortable and reports the clicked column", async () => {
    const onSort = vi.fn();
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} sort="km" dir="desc" onSort={onSort} />);
    expect(screen.queryByRole("button", { name: /Notes/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Vehicle/ }));
    expect(onSort).toHaveBeenCalledWith("name");
    expect(screen.getByRole("columnheader", { name: /Odometer/ }).getAttribute("aria-sort")).toBe("descending");
  });

  it("calls onRowClick with the row", async () => {
    const onRowClick = vi.fn();
    render(<DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={onRowClick} />);
    await userEvent.click(screen.getByText("KA 01 CD 5678"));
    expect(onRowClick).toHaveBeenCalledWith(rows[1]);
  });

  it("shows loading, empty and error states instead of a blank table", async () => {
    const { rerender } = render(<DataTable columns={columns} rows={undefined} rowKey={(r) => r.id} loading />);
    expect(screen.getByRole("status")).toBeTruthy();

    rerender(<DataTable columns={columns} rows={[]} rowKey={(r) => r.id} empty={{ title: "No vehicles yet", description: "Add one." }} />);
    expect(screen.getByText("No vehicles yet")).toBeTruthy();

    const onRetry = vi.fn();
    rerender(<DataTable columns={columns} rows={undefined} rowKey={(r) => r.id} error="Server unavailable" onRetry={onRetry} />);
    expect(screen.getByRole("alert").textContent).toContain("Server unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});

describe("Pagination", () => {
  it("shows the visible range and moves between pages", async () => {
    const onPage = vi.fn();
    render(<Pagination page={2} pageCount={5} total={47} pageSize={10} onPage={onPage} noun="vehicles" />);
    expect(screen.getByText(/Showing/).textContent).toBe("Showing 11–20 of 47 vehicles");
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await userEvent.click(screen.getByRole("button", { name: "Previous page" }));
    expect(onPage.mock.calls).toEqual([[3], [1]]);
  });

  it("disables the buttons at the ends and clamps the last range", () => {
    const { rerender } = render(<Pagination page={1} pageCount={5} total={47} pageSize={10} onPage={() => undefined} />);
    expect((screen.getByRole("button", { name: "Previous page" }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<Pagination page={5} pageCount={5} total={47} pageSize={10} onPage={() => undefined} />);
    expect((screen.getByRole("button", { name: "Next page" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Showing/).textContent).toContain("41–47 of 47");
  });

  it("changes the page size and renders nothing for an empty list", async () => {
    const onPageSize = vi.fn();
    const { rerender, container } = render(<Pagination page={1} pageCount={5} total={47} pageSize={10} onPage={() => undefined} onPageSize={onPageSize} />);
    await userEvent.selectOptions(screen.getByLabelText("Rows per page"), "50");
    expect(onPageSize).toHaveBeenCalledWith(50);
    rerender(<Pagination page={1} pageCount={1} total={0} pageSize={10} onPage={() => undefined} />);
    expect(container.textContent).toBe("");
  });
});

describe("search and filters", () => {
  it("emits typed text and can be cleared", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<SearchInput value="" onChange={onChange} placeholder="Search vehicles" />);
    fireEvent.change(screen.getByLabelText("Search vehicles"), { target: { value: "MH 12" } });
    expect(onChange).toHaveBeenCalledWith("MH 12");
    rerender(<SearchInput value="MH 12" onChange={onChange} placeholder="Search vehicles" />);
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });

  it("offers an 'all' option plus the given options", async () => {
    const onChange = vi.fn();
    render(<FilterSelect label="Statuses" value="" onChange={onChange} options={[{ value: "AVAILABLE", label: "Available" }]} />);
    const select = screen.getByLabelText("Statuses");
    expect(within(select).getByText("All statuses")).toBeTruthy();
    await userEvent.selectOptions(select, "AVAILABLE");
    expect(onChange).toHaveBeenCalledWith("AVAILABLE");
  });
});

describe("form fields", () => {
  it("links the label, marks required fields and announces errors", () => {
    render(<FormField field={{ name: "registrationNumber", label: "Registration number", required: true, hint: "Indian format" }} value="bad" error="Use the Indian format" onChange={() => undefined} />);
    const input = screen.getByLabelText(/Registration number/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Use the Indian format");
    // The hint gives way to the error message.
    expect(screen.queryByText("Indian format")).toBeNull();
  });

  it("renders select options and reports changes", async () => {
    const onChange = vi.fn();
    render(<FormField field={{ name: "type", label: "Type", type: "select", options: [{ value: "VAN", label: "Van" }, { value: "TRUCK", label: "Truck", disabled: true }] }} value="" onChange={onChange} />);
    await userEvent.selectOptions(screen.getByLabelText("Type"), "VAN");
    expect(onChange).toHaveBeenCalledWith("VAN");
    expect((screen.getByRole("option", { name: "Truck" }) as HTMLOptionElement).disabled).toBe(true);
  });

  it("reports checkbox state as a boolean", async () => {
    const onChange = vi.fn();
    render(<FormField field={{ name: "isActive", label: "Account is active", type: "checkbox" }} value={false} onChange={onChange} />);
    await userEvent.click(screen.getByLabelText(/Account is active/));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("page building blocks", () => {
  it("renders a stat card with its value and hint", () => {
    render(<StatCard label="Active deliveries" value={8} hint="3 pending dispatch" />);
    expect(screen.getByText("Active deliveries")).toBeTruthy();
    expect(screen.getByText("8")).toBeTruthy();
    expect(screen.getByText("3 pending dispatch")).toBeTruthy();
  });

  it("renders empty and error states with their actions", () => {
    render(<><EmptyState title="Nothing here" description="Try again later." /><ErrorState message="Boom" /></>);
    expect(screen.getByText("Nothing here")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Boom");
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
