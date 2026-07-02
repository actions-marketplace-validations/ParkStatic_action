import { useQuery } from "@tanstack/react-query";

export function App() {
  const { data } = useQuery({
    queryKey: ["greeting"],
    queryFn: () => Promise.resolve("data loaded"),
    initialData: "data loaded",
  });

  return (
    <main>
      <h1 data-testid="marker">Hello from the Lovable react-query fixture</h1>
      <p>react-query status: {data}</p>
    </main>
  );
}
