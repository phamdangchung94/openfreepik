"use client";

import { useFormContext } from "react-hook-form";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import type { GeneratorFormValues } from "@/lib/form/generator-schema";

interface ImageUrlFieldProps {
  name: "start_image_url" | "end_image_url";
  label: string;
  required?: boolean;
  placeholder?: string;
}

export function ImageUrlField({
  name,
  label,
  required,
  placeholder = "https://example.com/image.jpg",
}: ImageUrlFieldProps) {
  const {
    register,
    formState: { errors },
  } = useFormContext<GeneratorFormValues>();

  const error = errors[name];

  return (
    <div className="space-y-2">
      <Label htmlFor={name}>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      <Input
        id={name}
        type="url"
        placeholder={placeholder}
        {...register(name)}
      />
      {error && (
        <p className="text-sm text-destructive">{error.message}</p>
      )}
    </div>
  );
}
