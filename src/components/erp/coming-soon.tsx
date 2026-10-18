import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/erp/common";

export function ComingSoon({ title, description, items }: { title: string; description: string; items: string[] }) {
  return (
    <div className="flex flex-col gap-6 p-8">
      <PageHeader title={title} description={description} />
      <Card>
        <CardHeader>
          <CardTitle className="font-montserrat text-base">En construcción</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
