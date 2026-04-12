"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MessageSquare,
  Package,
  Plus,
  RotateCcw,
  Tag,
  Truck,
  ChevronRight,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const ICON_MAP = {
  Package,
  RotateCcw,
  Truck,
  MessageSquare,
  Tag,
  BookOpen,
};

function CategoryIcon({ name, className }) {
  const Icon = ICON_MAP[name] || Tag;
  return <Icon className={className} />;
}

function CategoryCard({ category, onClick }) {
  return (
    <Card
      className="group cursor-pointer transition-colors hover:bg-muted/50"
      onClick={onClick}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex h-9 w-9 items-center justify-center rounded-md bg-muted">
            <CategoryIcon name={category.icon} className="h-4 w-4 text-muted-foreground" />
          </div>
          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </div>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-sm">{category.label}</CardTitle>
        {category.description && (
          <CardDescription className="mt-1 text-xs line-clamp-2">
            {category.description}
          </CardDescription>
        )}
      </CardContent>
    </Card>
  );
}

export function KnowledgeCategoriesClient() {
  const router = useRouter();
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge/categories", { credentials: "include" });
      const data = await res.json().catch(() => ({}));
      setCategories(data?.categories ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  const handleCreate = () => {
    const label = newLabel.trim();
    if (!label) return;
    const slug = label
      .toLowerCase()
      .replace(/[^a-z0-9æøå\s-]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");
    setCreateOpen(false);
    setNewLabel("");
    router.push(`/knowledge/${slug}?label=${encodeURIComponent(label)}&new=1`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Knowledge Base</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage what your AI knows about your store
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New category
        </Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-9 w-9 rounded-md" />
              </CardHeader>
              <CardContent className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {categories.map((cat) => (
            <CategoryCard
              key={cat.slug}
              category={cat}
              onClick={() => router.push(`/knowledge/${cat.slug}`)}
            />
          ))}
          <Card
            className="cursor-pointer border-dashed hover:bg-muted/30 transition-colors"
            onClick={() => setCreateOpen(true)}
          >
            <CardContent className="flex flex-col items-center justify-center h-full min-h-[120px] text-muted-foreground gap-2 pt-6">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-dashed">
                <Plus className="h-4 w-4" />
              </div>
              <span className="text-sm">New category</span>
            </CardContent>
          </Card>
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Create new category</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                placeholder="e.g. Warranty, Technical support..."
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!newLabel.trim() || creating}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
