import { useCallback } from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface FileUploaderProps {
  onFileSelect: (file: File) => void;
  isProcessing?: boolean;
}

export function FileUploader({ onFileSelect, isProcessing = false }: FileUploaderProps) {
  const { toast } = useToast();

  const handleFileChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) return;

      if (!file.name.endsWith(".csv")) {
        toast({
          title: "Invalid file type",
          description: "Please upload a CSV file",
          variant: "destructive",
        });
        return;
      }

      onFileSelect(file);
    },
    [onFileSelect, toast]
  );

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex flex-col items-center justify-center space-y-4 p-12 border-2 border-dashed border-border rounded-lg bg-muted/20">
          <Upload className="h-12 w-12 text-muted-foreground" />
          <div className="text-center">
            <h3 className="text-lg font-semibold mb-2">Upload Banking Data</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Upload your CSV file to begin analysis
            </p>
          </div>
          <div>
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              disabled={isProcessing}
              className="hidden"
              id="csv-upload"
            />
            <label htmlFor="csv-upload">
              <Button disabled={isProcessing} asChild>
                <span>{isProcessing ? "Processing..." : "Select CSV File"}</span>
              </Button>
            </label>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
