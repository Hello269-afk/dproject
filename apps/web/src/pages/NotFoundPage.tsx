import { Link } from "react-router";
import { Compass } from "lucide-react";
import { EmptyState, Button } from "../components/ui";

export function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass />}
      title="Page not found"
      description="The page you're looking for doesn't exist or has moved."
      action={
        <Link to="/">
          <Button variant="primary">Back to overview</Button>
        </Link>
      }
    />
  );
}
